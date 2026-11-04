import { createHash, randomUUID } from "node:crypto";
import { constants, createReadStream } from "node:fs";
import {
  mkdir,
  readFile,
  readdir,
  writeFile,
  rename,
  rm,
  stat,
  open,
  realpath,
  type FileHandle,
} from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { selectComposition, renderMedia } from "@remotion/renderer";
import { videoDimensions, totalFrames, type Timeline } from "./schema";
import { runCommand } from "./process";
import type { RenderBrowser } from "./render-browser";
import { renderCacheWorkspaceDirectory } from "./render-cache-path";
import { staticScenePlan } from "./static-scene";
import { renderStaticScene } from "./render-static";
import { videoCompositePlan } from "./video-composite-plan";
import { renderVideoComposite } from "./render-video-composite";
import { renderMediaResources } from "./render-resources";
import { openSceneCacheNamespace } from "./cache-retention";
export type SceneCacheResult = {
  sceneId: string;
  reused: boolean;
  key: string;
  frameReuse?: { captured: number; total: number };
  compositeReuse?: { captured: number; total: number };
};
async function fileDigest(file: string) {
  const hash = createHash("sha256");
  for await (const bytes of createReadStream(file)) hash.update(bytes);
  return hash.digest("hex");
}
export function localSceneTimeline(t: Timeline, index: number): Timeline {
  const start = t.scenes
      .slice(0, index)
      .reduce((n, s) => n + s.durationFrames, 0),
    end = start + t.scenes[index].durationFrames;
  return {
    fps: t.fps,
    format: t.format,
    ...(t.exportResolution ? { exportResolution: t.exportResolution } : {}),
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
    "src/lib/render-static.ts",
    "src/lib/static-scene.ts",
    "src/lib/video-composite-plan.ts",
    "src/lib/render-video-composite.ts",
    "src/lib/render-resources.ts",
    "src/lib/render-browser.ts",
    "src/lib/schema.ts",
    "src/lib/text-style.ts",
    "src/lib/media-style.ts",
    "src/lib/layer-geometry.ts",
    "src/lib/captions.ts",
    "src/lib/audio-math.ts",
    "src/lib/clip-audio.ts",
    "src/lib/render-assets.ts",
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
      dim = videoDimensions(t);
    return (
      stream?.codec_name === "h264" &&
      stream.width === dim.width &&
      stream.height === dim.height &&
      stream.r_frame_rate === "30/1" &&
      Number(stream.nb_frames) === totalFrames(t) &&
      Math.abs(Number(meta.format.duration) - totalFrames(t) / 30) < 0.04
    );
  } catch {
    return false;
  }
}
export async function cacheEntryValid(dir: string, t: Timeline, key: string) {
  let directory: FileHandle | undefined,
    manifestFile: FileHandle | undefined,
    video: FileHandle | undefined;
  try {
    directory = await open(
      dir,
      constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
    );
    const root =
      process.platform === "linux"
        ? `/proc/${process.pid}/fd/${directory.fd}`
        : await realpath(dir);
    manifestFile = await open(
      path.join(root, "manifest.json"),
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    const metadata = await manifestFile.stat();
    if (!metadata.isFile() || metadata.size < 1 || metadata.size > 8192)
      return false;
    const bytes = Buffer.alloc(metadata.size);
    const read = await manifestFile.read(bytes, 0, bytes.length, 0);
    if (
      read.bytesRead !== bytes.length ||
      (await manifestFile.stat()).size !== bytes.length
    )
      return false;
    const manifest = JSON.parse(bytes.toString());
    if (
      manifest.key !== key ||
      manifest.frames !== totalFrames(t) ||
      typeof manifest.sha256 !== "string" ||
      !/^[a-f0-9]{64}$/.test(manifest.sha256)
    )
      return false;
    video = await open(
      path.join(root, "video.mp4"),
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    const before = await video.stat();
    if (!before.isFile() || before.size < 1000 || before.size > 2 * 1024 ** 3)
      return false;
    const pinned =
      process.platform === "linux"
        ? `/proc/${process.pid}/fd/${video.fd}`
        : path.join(root, "video.mp4");
    if (
      manifest.sha256 !== (await fileDigest(pinned)) ||
      !(await validClip(pinned, t))
    )
      return false;
    const after = await video.stat();
    if (
      before.size !== after.size ||
      before.mtimeMs !== after.mtimeMs ||
      before.ctimeMs !== after.ctimeMs
    )
      return false;
    // Published clips are immutable; only successful validation refreshes LRU.
    const now = new Date();
    await manifestFile.utimes(now, now);
    return true;
  } catch {
    return false;
  } finally {
    await Promise.all([
      video?.close(),
      manifestFile?.close(),
      directory?.close(),
    ]);
  }
}
type CachedSceneOptions = {
  namespace?: string;
  timeline: Timeline;
  serveUrl: string;
  assetSources: Record<string, string>;
  assetFingerprints?: Record<string, string>;
  browserExecutable: string;
  puppeteerInstance: RenderBrowser;
  outputLocation: string;
  cancelSignal: Parameters<typeof renderMedia>[0]["cancelSignal"];
  isCancelled: () => boolean;
  onProgress: (n: number) => void;
};
export async function renderCachedScenes(options: CachedSceneOptions) {
  // Linux production holds this namespace inode through native concatenation.
  // Development platforms retain the existing path-based rendering fallback.
  if (process.platform !== "linux") {
    if (process.env.NODE_ENV === "production")
      throw new Error("Production scene caching requires Linux.");
    const directory = renderCacheWorkspaceDirectory(
      options.namespace || "local",
    );
    await mkdir(directory, { recursive: true });
    return renderScenesInDirectory(options, directory);
  }
  const owned = openSceneCacheNamespace(options.namespace || "local");
  try {
    return await renderScenesInDirectory(options, owned.directory);
  } finally {
    owned.close();
  }
}
async function renderScenesInDirectory(
  options: CachedSceneOptions,
  cacheRoot: string,
) {
  const {
    timeline,
    serveUrl,
    assetSources,
    browserExecutable,
    puppeteerInstance,
    outputLocation,
    cancelSignal,
    isCancelled,
    onProgress,
  } = options;
  const source = await (sourceFingerprint ??= fingerprint());
  const clips: string[] = [],
    cache: SceneCacheResult[] = [];
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
    let frameReuse: SceneCacheResult["frameReuse"];
    let compositeReuse: SceneCacheResult["compositeReuse"];
    if (!reused) {
      const staging = path.join(cacheRoot, `.partial-${randomUUID()}`);
      await mkdir(staging);
      try {
        const composition = await selectComposition({
          serveUrl,
          id: "Reelchemy",
          inputProps: { timeline: local, assetSources },
          browserExecutable,
          puppeteerInstance,
        });
        const staticPlan = staticScenePlan(local);
        const compositePlan = videoCompositePlan(local);
        const rendering = {
          serveUrl,
          composition,
          browserExecutable,
          puppeteerInstance,
          outputLocation: path.join(staging, "video.mp4"),
          cancelSignal,
          onProgress: (progress: number) =>
            onProgress(
              (0.88 * (completed + totalFrames(local) * progress)) /
                totalFrames(timeline),
            ),
        };
        if (staticPlan) {
          await renderStaticScene({
            ...rendering,
            timeline: local,
            plan: staticPlan,
            assetSources,
            isCancelled,
          });
          frameReuse = {
            captured: staticPlan.capturedFrames.length,
            total: totalFrames(local),
          };
        } else if (compositePlan) {
          await renderVideoComposite({
            ...rendering,
            timeline: local,
            plan: compositePlan,
            assetSources,
            isCancelled,
          });
          compositeReuse = {
            captured: 1 + compositePlan.capturedFrames.length,
            total: totalFrames(local),
          };
        } else
          await renderMedia({
            ...rendering,
            ...renderMediaResources,
            inputProps: { timeline: local, assetSources },
            codec: "h264",
            muted: true,
            pixelFormat: "yuv420p",
            concurrency: Math.max(
              1,
              Math.min(4, Number(process.env.RENDER_CONCURRENCY) || 2),
            ),
            timeoutInMilliseconds: 60000,
            onProgress: ({ progress }) => rendering.onProgress(progress),
          });
        if (!(await validClip(path.join(staging, "video.mp4"), local)))
          throw new Error("Rendered scene failed verification.");
        await writeFile(
          path.join(staging, "manifest.json"),
          JSON.stringify({
            key,
            sha256: await fileDigest(path.join(staging, "video.mp4")),
            frames: totalFrames(local),
            ...(frameReuse ? { frameReuse } : {}),
            ...(compositeReuse ? { compositeReuse } : {}),
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
    cache.push({
      sceneId: local.scenes[0].id,
      reused,
      key,
      ...(frameReuse ? { frameReuse } : {}),
      ...(compositeReuse ? { compositeReuse } : {}),
    });
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
