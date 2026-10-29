import { createHash, randomUUID } from "node:crypto";
import {
  mkdir,
  readFile,
  readdir,
  writeFile,
  rename,
  rm,
  stat,
} from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { selectComposition, renderMedia } from "@remotion/renderer";
import { formats, totalFrames, type Timeline } from "./schema";
import { runCommand } from "./process";
export function localSceneTimeline(t: Timeline, index: number): Timeline {
  const start = t.scenes
      .slice(0, index)
      .reduce((n, s) => n + s.durationFrames, 0),
    end = start + t.scenes[index].durationFrames;
  return {
    fps: t.fps,
    format: t.format,
    scenes: [t.scenes[index]],
    ...(t.captionStyle && t.captions?.length
      ? { captionStyle: t.captionStyle }
      : {}),
    ...(t.captions?.length
      ? {
          captions: t.captions
            .filter((c) => c.startFrame < end && c.endFrame > start)
            .map((c) => ({
              ...c,
              startFrame: Math.max(0, c.startFrame - start),
              endFrame: Math.min(end - start, c.endFrame - start),
            })),
        }
      : {}),
  };
}
export function sceneCacheKey(
  t: Timeline,
  assetSources: Record<string, string>,
  fingerprint: string,
  assetFingerprints: Record<string, string> = {},
) {
  const hash = createHash("sha256")
    .update("scene-cache-v1:h264:yuv420p")
    .update(fingerprint)
    .update(JSON.stringify(t));
  const ids = [
    ...new Set(
      t.scenes.flatMap((s) =>
        s.layers.flatMap((l) => (l.assetId ? [l.assetId] : [])),
      ),
    ),
  ].sort();
  for (const id of ids)
    hash
      .update(id)
      .update(assetFingerprints[id] || assetSources[id] || "MISSING");
  return hash.digest("hex");
}
let sourceFingerprint: Promise<string> | undefined;
async function fingerprint() {
  const hash = createHash("sha256");
  async function walk(dir: string) {
    for (const f of (await readdir(dir, { withFileTypes: true })).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      const file = path.join(dir, f.name);
      if (f.isDirectory()) await walk(file);
      else if (/\.tsx?$/.test(f.name))
        hash.update(file).update(await readFile(file));
    }
  }
  await walk("src/video");
  for (const f of [
    "src/lib/render-cache.ts",
    "src/lib/schema.ts",
    "src/lib/text-style.ts",
    "src/lib/captions.ts",
    "src/lib/audio-math.ts",
    "src/lib/clip-audio.ts",
    "src/lib/video-server.ts",
    "node_modules/remotion/package.json",
  ])
    hash.update(await readFile(f));
  hash.update(
    execFileSync(
      process.env.CHROMIUM_PATH || "/usr/bin/chromium",
      ["--version"],
      { encoding: "utf8", timeout: 10000 },
    ),
  );
  return hash.digest("hex");
}
async function validClip(file: string, t: Timeline) {
  try {
    if ((await stat(file)).size < 1000) return false;
    const meta = JSON.parse(
      execFileSync(
        "ffprobe",
        ["-v", "error", "-show_streams", "-show_format", "-of", "json", file],
        { encoding: "utf8", timeout: 15000, stdio: ["ignore", "pipe", "pipe"] },
      ),
    );
    const stream = meta.streams.find(
        (s: { codec_type: string }) => s.codec_type === "video",
      ),
      dim = formats[t.format];
    return (
      stream?.codec_name === "h264" &&
      stream.width === dim.width &&
      stream.height === dim.height &&
      stream.r_frame_rate === "30/1" &&
      Math.abs(Number(meta.format.duration) - totalFrames(t) / 30) < 0.04
    );
  } catch {
    return false;
  }
}
export async function cacheEntryValid(dir: string, t: Timeline, key: string) {
  try {
    const manifest = JSON.parse(
      await readFile(path.join(dir, "manifest.json"), "utf8"),
    );
    if (
      manifest.key !== key ||
      manifest.frames !== totalFrames(t) ||
      !manifest.sha256
    )
      return false;
    const digest = createHash("sha256")
      .update(await readFile(path.join(dir, "video.mp4")))
      .digest("hex");
    return (
      manifest.sha256 === digest &&
      (await validClip(path.join(dir, "video.mp4"), t))
    );
  } catch {
    return false;
  }
}
export async function renderCachedScenes(options: {
  namespace?: string;
  timeline: Timeline;
  serveUrl: string;
  assetSources: Record<string, string>;
  assetFingerprints?: Record<string, string>;
  browserExecutable: string;
  outputLocation: string;
  cancelSignal: Parameters<typeof renderMedia>[0]["cancelSignal"];
  isCancelled: () => boolean;
  onProgress: (n: number) => void;
}) {
  const {
    timeline,
    serveUrl,
    assetSources,
    browserExecutable,
    outputLocation,
    cancelSignal,
    isCancelled,
    onProgress,
  } = options;
  const namespace = options.namespace || "local";
  if (!/^(?:local|legacy|[a-f0-9-]{36})$/.test(namespace))
    throw new Error("Invalid render cache workspace.");
  const cacheRoot = path.resolve(
    process.env.REELCHEMY_RENDER_CACHE_DIR || "artifacts/.scene-cache",
    namespace,
  );
  await mkdir(cacheRoot, { recursive: true });
  const source = await (sourceFingerprint ??= fingerprint());
  const clips: string[] = [],
    cache: { sceneId: string; reused: boolean; key: string }[] = [];
  let completed = 0;
  for (let i = 0; i < timeline.scenes.length; i++) {
    if (isCancelled()) throw new Error("Render cancelled.");
    const local = localSceneTimeline(timeline, i),
      key = sceneCacheKey(
        local,
        assetSources,
        source,
        options.assetFingerprints,
      ),
      target = path.join(cacheRoot, key),
      video = path.join(target, "video.mp4");
    let reused = await cacheEntryValid(target, local, key);
    if (!reused) {
      const staging = path.join(cacheRoot, `.partial-${randomUUID()}`);
      await mkdir(staging);
      try {
        const composition = await selectComposition({
          serveUrl,
          id: "Reelchemy",
          inputProps: { timeline: local, assetSources },
          browserExecutable,
        });
        await renderMedia({
          serveUrl,
          composition,
          inputProps: { timeline: local, assetSources },
          browserExecutable,
          codec: "h264",
          muted: true,
          pixelFormat: "yuv420p",
          concurrency: Math.max(
            1,
            Math.min(4, Number(process.env.RENDER_CONCURRENCY) || 2),
          ),
          outputLocation: path.join(staging, "video.mp4"),
          cancelSignal,
          timeoutInMilliseconds: 60000,
          onProgress: ({ progress }) =>
            onProgress(
              (0.88 * (completed + totalFrames(local) * progress)) /
                totalFrames(timeline),
            ),
        });
        if (!(await validClip(path.join(staging, "video.mp4"), local)))
          throw new Error("Rendered scene failed verification.");
        await writeFile(
          path.join(staging, "manifest.json"),
          JSON.stringify({
            key,
            sha256: createHash("sha256")
              .update(await readFile(path.join(staging, "video.mp4")))
              .digest("hex"),
            frames: totalFrames(local),
            createdAt: new Date().toISOString(),
          }),
        );
        if (await cacheEntryValid(target, local, key)) {
          reused = true;
          await rm(staging, { recursive: true, force: true });
        } else {
          await rm(target, { recursive: true, force: true });
          await rename(staging, target);
        }
      } catch (e) {
        await rm(staging, { recursive: true, force: true });
        throw e;
      }
    }
    clips.push(video);
    cache.push({ sceneId: local.scenes[0].id, reused, key });
    completed += totalFrames(local);
    onProgress((0.88 * completed) / totalFrames(timeline));
  }
  const list = path.join(path.dirname(outputLocation), "concat-scenes.txt");
  await writeFile(
    list,
    clips.map((file) => `file '${file.replace(/'/g, "'\\''")}'`).join("\n"),
  );
  await runCommand(
    "ffmpeg",
    [
      "-v",
      "error",
      "-y",
      "-protocol_whitelist",
      "file,pipe",
      "-f",
      "concat",
      "-safe",
      "0",
      "-i",
      list,
      "-map",
      "0:v:0",
      "-c:v",
      "copy",
      "-an",
      "-movflags",
      "+faststart",
      outputLocation,
    ],
    { timeoutMs: 60000, cancelled: isCancelled },
  );
  return cache;
}
