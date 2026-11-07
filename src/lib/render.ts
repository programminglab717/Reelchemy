import { serveRenderAssets } from "./render-assets";
import { withRenderBrowser } from "./render-browser";
import { renderCachedScenes, type SceneCacheResult } from "./render-cache";
import { runCommand } from "./process";
import { muxAudio, type AudioMixReport } from "./audio";
import { subtitles } from "./captions";
import { rendererBundle } from "./renderer-bundle";
import { makeCancelSignal } from "@remotion/renderer";
import { mkdir, writeFile, stat } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import path from "node:path";
import {
  type Timeline,
  type QCIssue,
  totalFrames,
  videoDimensions,
} from "./schema";
import { checkLayout, RenderQCError } from "./layout-qc";
import { repairBounds } from "./qc";
import { clipAudioTracks } from "./clip-audio";
import { captureEncodedEvidence } from "./render-evidence";
export async function renderFilm(
  input: Timeline,
  outputDir: string,
  onProgress: (p: number) => void = () => {},
  isCancelled: () => boolean = () => false,
  onStage: (stage: string) => void = () => {},
  cacheNamespace: string = "local",
) {
  onStage("Checking assets");
  const media = await serveRenderAssets(input, isCancelled);
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
      media.motionBaseUrl,
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
  motionBaseUrl = "",
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
  const layout = await checkLayout(
    timeline,
    outputDir,
    isCancelled,
    assetSources,
  );
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
  const serveUrl = await rendererBundle();
  if (isCancelled()) throw new Error("Render cancelled.");
  const browserExecutable = process.env.CHROMIUM_PATH || "/usr/bin/chromium";
  return withRenderBrowser(browserExecutable, async (puppeteerInstance) => {
    const outputLocation = path.join(outputDir, "video.mp4");
    let sceneCache: SceneCacheResult[] = [];
    let audioReport: AudioMixReport = {
      tracks: 0,
      codec: null,
      peakDb: null,
      duration: null,
    };
    const hasAudio =
      (timeline.audioTracks || []).length + clipAudioTracks(timeline).length >
      0;
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
        motionBaseUrl,
        browserExecutable,
        puppeteerInstance,
        outputLocation,
        cancelSignal: cancel.cancelSignal,
        isCancelled,
        onProgress,
        ...(hasAudio
          ? {
              finalize: async (silentVideo: string) => {
                onStage("Mixing audio");
                audioReport = await muxAudio(
                  timeline,
                  silentVideo,
                  isCancelled,
                  outputLocation,
                );
              },
            }
          : {}),
      });
    } finally {
      clearInterval(timer);
    }
    if (isCancelled()) throw new Error("Render cancelled.");

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
    const expected = videoDimensions(timeline);
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
    if (Number(video.nb_frames) !== totalFrames(timeline))
      throw new Error("Encoded video frame-count verification failed.");
    onStage("Verifying encoded frames and scene previews");
    const samples = await captureEncodedEvidence(
      timeline,
      outputLocation,
      outputDir,
      isCancelled,
    );
    let start = 0;
    for (const [i, scene] of timeline.scenes.entries()) {
      if (isCancelled()) throw new Error("Render cancelled.");
      await runCommand(
        "ffmpeg",
        [
          "-v",
          "error",
          "-y",
          "-threads",
          "2",
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
          "-threads",
          "2",
          path.join(outputDir, `scene-${i + 1}-motion.mp4`),
        ],
        { timeoutMs: 30000, cancelled: isCancelled },
      );
      start += scene.durationFrames;
      onProgress(0.88 + (0.1 * (i + 1)) / timeline.scenes.length);
    }
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
  });
}
