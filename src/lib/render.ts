import { serveVideoAssets } from "./video-server";
import { renderCachedScenes } from "./render-cache";
import { runCommand } from "./process";
import { muxAudio } from "./audio";
import { subtitles } from "./captions";
import { bundle } from "@remotion/bundler";
import {
  selectComposition,
  renderStill,
  makeCancelSignal,
} from "@remotion/renderer";
import { mkdir, writeFile, stat } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { type Timeline, type QCIssue, totalFrames, formats } from "./schema";
import { checkLayout, RenderQCError } from "./layout-qc";
import { resolveAssetSources } from "./assets";
import { repairBounds } from "./qc";
let bundled: Promise<string> | undefined;
export async function renderFilm(
  input: Timeline,
  outputDir: string,
  onProgress: (p: number) => void = () => {},
  isCancelled: () => boolean = () => false,
  onStage: (stage: string) => void = () => {},
  cacheNamespace: string = "local",
) {
  onStage("Checking assets");
  const media = await serveVideoAssets(input, await resolveAssetSources(input));
  try {
    return await renderResolved(
      input,
      outputDir,
      onProgress,
      isCancelled,
      onStage,
      cacheNamespace,
      media.sources,
      media.fingerprints,
    );
  } finally {
    await media.close();
  }
}
async function renderResolved(
  input: Timeline,
  outputDir: string,
  onProgress: (p: number) => void,
  isCancelled: () => boolean,
  onStage: (stage: string) => void,
  cacheNamespace: string,
  assetSources: Record<string, string>,
  assetFingerprints: Record<string, string>,
) {
  const repaired = repairBounds(input, 1, Object.keys(assetSources));
  let timeline = repaired.timeline;
  if (repaired.after.some((i) => i.severity === "error"))
    throw new Error(
      `QC blocked export: ${repaired.after
        .filter((i) => i.severity === "error")
        .map((i) => i.message)
        .join(" ")}`,
    );
  await mkdir(outputDir, { recursive: true });
  onStage("Checking layout");
  const layout = await checkLayout(timeline, outputDir, isCancelled);
  timeline = layout.timeline;
  if (layout.after.length) {
    await writeFile(
      path.join(outputDir, "report.json"),
      JSON.stringify({ qc: { layout }, timeline }, null, 2),
    );
    throw new RenderQCError(layout.after);
  }
  if (isCancelled()) throw new Error("Render cancelled.");
  onStage("Preparing composition");
  const serveUrl = await (bundled ??= bundle({
    entryPoint: path.resolve("src/video/index.tsx"),
  }).catch((error) => {
    bundled = undefined;
    throw error;
  }));
  const browserExecutable = process.env.CHROMIUM_PATH || "/usr/bin/chromium";
  const options = {
    serveUrl,
    id: "Reelchemy",
    inputProps: { timeline, assetSources },
    browserExecutable,
  };
  const composition = await selectComposition(options);
  const outputLocation = path.join(outputDir, "video.mp4");
  let sceneCache: { sceneId: string; reused: boolean; key: string }[] = [];
  const cancel = makeCancelSignal();
  const timer = setInterval(() => {
    if (isCancelled()) cancel.cancel();
  }, 300);
  try {
    onStage("Rendering frames");
    sceneCache = await renderCachedScenes({
      timeline,
      namespace: cacheNamespace,
      serveUrl,
      assetSources,
      assetFingerprints,
      browserExecutable,
      outputLocation,
      cancelSignal: cancel.cancelSignal,
      isCancelled,
      onProgress,
    });
  } finally {
    clearInterval(timer);
  }
  if (isCancelled()) throw new Error("Render cancelled.");
  onStage("Mixing audio");
  const audioReport = await muxAudio(timeline, outputLocation, isCancelled);
  await writeFile(
    path.join(outputDir, "captions.srt"),
    subtitles(timeline, "srt"),
  );
  await writeFile(
    path.join(outputDir, "captions.vtt"),
    subtitles(timeline, "vtt"),
  );
  onStage("Verifying export");
  const probe = JSON.parse(
    execFileSync(
      "ffprobe",
      [
        "-v",
        "error",
        "-show_streams",
        "-show_format",
        "-of",
        "json",
        outputLocation,
      ],
      { encoding: "utf8", timeout: 15000 },
    ),
  );
  const video = probe.streams.find(
    (s: { codec_type: string }) => s.codec_type === "video",
  );
  const expected = formats[timeline.format];
  const duration = Number(probe.format.duration),
    target = totalFrames(timeline) / timeline.fps;
  if (
    !video ||
    video.codec_name !== "h264" ||
    video.width !== expected.width ||
    video.height !== expected.height ||
    video.r_frame_rate !== "30/1" ||
    Math.abs(duration - target) > 1 / timeline.fps + 0.01
  )
    throw new Error(
      "Encoded video failed codec/dimensions/fps/duration verification.",
    );
  // Decode all encoded frames: catches damaged files, not artistic motion defects.
  await runCommand(
    "ffmpeg",
    ["-v", "error", "-xerror", "-i", outputLocation, "-f", "null", "-"],
    { timeoutMs: 120000, cancelled: isCancelled },
  );
  onStage("Preparing scene previews");
  let start = 0;
  const samples = [];
  for (const [i, scene] of timeline.scenes.entries()) {
    if (isCancelled()) throw new Error("Render cancelled.");
    for (const [label, offset] of [
      ["begin", Math.min(10, scene.durationFrames - 1)],
      ["middle", Math.floor(scene.durationFrames / 2)],
      ["end", Math.max(0, scene.durationFrames - 11)],
      ...[
        ...new Set([
          ...scene.layers.flatMap((l) =>
            (l.keyframes || []).map((k) => k.frame),
          ),
          ...(scene.camera || []).map((k) => k.frame),
        ]),
      ]
        .slice(0, 8)
        .map((f) => [`event-${f}`, f] as const),
    ] as const) {
      if (isCancelled()) throw new Error("Render cancelled.");
      const name = `scene-${i + 1}-${label}.png`;
      await renderStill({
        ...options,
        composition,
        frame: start + offset,
        output: path.join(outputDir, name),
      });
      samples.push({ sceneId: scene.id, frame: start + offset, file: name });
    }
    // Actual moving segment for manual temporal review; screenshots alone are not motion QC.
    await runCommand(
      "ffmpeg",
      [
        "-v",
        "error",
        "-y",
        "-ss",
        String(start / 30),
        "-i",
        outputLocation,
        "-t",
        String(Math.min(2, scene.durationFrames / 30)),
        "-an",
        "-c:v",
        "libx264",
        "-preset",
        "fast",
        path.join(outputDir, `scene-${i + 1}-motion.mp4`),
      ],
      { timeoutMs: 30000, cancelled: isCancelled },
    );
    start += scene.durationFrames;
    onProgress(0.88 + (0.1 * (i + 1)) / timeline.scenes.length);
  }
  await renderStill({
    ...options,
    composition,
    frame: Math.min(25, totalFrames(timeline) - 1),
    output: path.join(outputDir, "thumbnail.png"),
  });
  const audioIssues: QCIssue[] =
    audioReport.tracks &&
    audioReport.peakDb !== null &&
    (audioReport.peakDb >= 0 || audioReport.peakDb < -80)
      ? [
          {
            sceneId: "audio",
            code: "audio-level",
            severity: "warning",
            message:
              audioReport.peakDb >= 0
                ? "Audio peak reached full scale; inspect for clipping."
                : "Mixed audio is near silent; check the selected source and trim.",
          },
        ]
      : [];
  const report = {
    export: {
      path: outputLocation,
      codec: video.codec_name,
      width: video.width,
      height: video.height,
      fps: 30,
      duration,
      bytes: (await stat(outputLocation)).size,
    },
    sceneCache,
    qc: {
      before: repaired.before,
      after: [...repaired.after, ...layout.after, ...audioIssues],
      layout,
      repairAttempts:
        repaired.attempts +
        (layout.changes.length ? Math.min(2, layout.changes.length) : 0),
      samples,
      temporalReview:
        "Per-scene moving clips generated for human review. Automated semantic/motion and audio review are not implemented.",
      audio: audioReport,
    },
    timeline,
  };
  await writeFile(
    path.join(outputDir, "report.json"),
    JSON.stringify(report, null, 2),
  );
  onStage("Completed");
  onProgress(1);
  return report;
}
