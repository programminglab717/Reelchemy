import { renderStill, type renderMedia } from "@remotion/renderer";
import { mkdtemp, link, rm } from "node:fs/promises";
import path from "node:path";
import { videoDimensions, type Timeline } from "./schema";
import type { VideoCompositePlan } from "./video-composite-plan";
import type { RenderBrowser } from "./render-browser";
import { renderMediaResources } from "./render-resources";
import {
  runCommand,
  CommandCancelledError,
  CommandTimeoutError,
} from "./process";

export async function renderVideoComposite(options: {
  timeline: Timeline;
  plan: VideoCompositePlan;
  composition: Parameters<typeof renderStill>[0]["composition"];
  serveUrl: string;
  assetSources: Record<string, string>;
  browserExecutable: string;
  puppeteerInstance: RenderBrowser;
  outputLocation: string;
  cancelSignal: Parameters<typeof renderMedia>[0]["cancelSignal"];
  isCancelled: () => boolean;
  onProgress: (n: number) => void;
}) {
  const { timeline, plan, isCancelled } = options;
  const check = () => {
    if (isCancelled()) throw new CommandCancelledError();
  };
  check();
  const source = options.assetSources[plan.video.assetId || ""];
  // Only the pinned job-local capability server, never user URLs or paths.
  if (
    !/^http:\/\/127\.0\.0\.1:[0-9]{1,5}\/[a-f0-9]{64}\/[a-f0-9-]{36}$/.test(
      source || "",
    )
  )
    throw new Error("Video compositing requires the prepared private source.");
  const dir = await mkdtemp(
    path.join(path.dirname(options.outputLocation), "composite-"),
  );
  const foreground = (frame: number) =>
    path.join(dir, `over-${String(frame).padStart(4, "0")}.png`);
  try {
    const capture = async (
      part: "under" | "over",
      frame: number,
      output: string,
    ) => {
      check();
      const props = {
        ...options.composition.props,
        timeline,
        assetSources: options.assetSources,
        compositePass: { videoLayerId: plan.video.id, part },
      };
      await renderStill({
        ...renderMediaResources,
        // A selected composition contains its resolved props. Updating only
        // inputProps would leave those resolved component props unchanged.
        composition: { ...options.composition, props },
        serveUrl: options.serveUrl,
        inputProps: props,
        browserExecutable: options.browserExecutable,
        puppeteerInstance: options.puppeteerInstance,
        // Remotion's PNG capture clears the browser background automatically.
        output,
        frame,
        imageFormat: "png",
        cancelSignal: options.cancelSignal,
        timeoutInMilliseconds: 60000,
      });
    };
    const under = path.join(dir, "under.png");
    await capture("under", 0, under);
    for (const [index, frame] of plan.capturedFrames.entries()) {
      await capture("over", frame, foreground(frame));
      options.onProgress((0.25 * (index + 1)) / plan.capturedFrames.length);
    }
    for (const [frame, representative] of plan.sourceFrames.entries()) {
      check();
      if (frame !== representative)
        await link(foreground(representative), foreground(frame));
    }
    // Asynchronous probing keeps the capability server responsive; a synchronous
    // process here would block its own HTTP source. Never log capability URLs.
    const probe = await runCommand(
      "ffprobe",
      [
        "-v",
        "error",
        "-protocol_whitelist",
        "http,tcp",
        "-select_streams",
        "v:0",
        "-show_entries",
        "stream=codec_name,width,height,nb_frames,r_frame_rate,sample_aspect_ratio",
        "-of",
        "json",
        source,
      ],
      { timeoutMs: 15000, cancelled: isCancelled },
    );
    const video = JSON.parse(probe.stdout).streams?.[0];
    const clip = plan.video.video!;
    if (
      video?.codec_name !== "h264" ||
      video.r_frame_rate !== "30/1" ||
      video.sample_aspect_ratio !== "1:1" ||
      !Number.isSafeInteger(video.width) ||
      video.width < 2 ||
      video.width > 1920 ||
      !Number.isSafeInteger(video.height) ||
      video.height < 2 ||
      video.height > 1920 ||
      !Number.isSafeInteger(Number(video.nb_frames)) ||
      Number(video.nb_frames) < clip.offsetFrames + clip.durationFrames
    )
      throw new Error("Video compositing requires bounded normalized footage.");
    const dimensions = videoDimensions(timeline);
    const box = {
      x: Math.round(plan.video.x * dimensions.width),
      y: Math.round(plan.video.y * dimensions.height),
      width: Math.max(1, Math.round(plan.video.width * dimensions.width)),
      height: Math.max(1, Math.round(plan.video.height * dimensions.height)),
    };
    const cover = clip.fit === "cover";
    const ratio = (cover ? Math.max : Math.min)(
      box.width / video.width,
      box.height / video.height,
    );
    const scaled = {
      width: Math.max(1, Math.round(video.width * ratio)),
      height: Math.max(1, Math.round(video.height * ratio)),
    };
    const position = {
      x: plan.video.mediaPosition?.x ?? 0.5,
      y: plan.video.mediaPosition?.y ?? 0.5,
    };
    const x =
      box.x + (cover ? 0 : Math.round((box.width - scaled.width) * position.x));
    const y =
      box.y +
      (cover ? 0 : Math.round((box.height - scaled.height) * position.y));
    const crop = cover
      ? `,crop=${box.width}:${box.height}:${Math.round((scaled.width - box.width) * position.x)}:${Math.round((scaled.height - box.height) * position.y)}`
      : "";
    const filter = [
      "[0:v]format=rgba[under]",
      `[1:v]trim=start_frame=${clip.offsetFrames}:end_frame=${clip.offsetFrames + clip.durationFrames},setpts=PTS-STARTPTS+${clip.startFrame}/30/TB,scale=${scaled.width}:${scaled.height}:flags=bicubic${crop},format=rgba[clip]`,
      `[under][clip]overlay=x=${x}:y=${y}:format=rgb:eof_action=pass:repeatlast=0:enable='gte(n,${clip.startFrame})*lt(n,${clip.startFrame + clip.durationFrames})'[middle]`,
      "[middle][2:v]overlay=0:0:format=rgb:shortest=1,scale=in_range=pc:out_range=pc,format=yuv420p[out]",
    ].join(";");
    await runCommand(
      "ffmpeg",
      [
        "-v",
        "error",
        "-y",
        "-threads",
        "2",
        "-filter_complex_threads",
        "1",
        "-loop",
        "1",
        "-framerate",
        "30",
        "-i",
        under,
        "-protocol_whitelist",
        "http,tcp",
        "-i",
        source,
        "-framerate",
        "30",
        "-i",
        path.join(dir, "over-%04d.png"),
        "-filter_complex",
        filter,
        "-map",
        "[out]",
        "-frames:v",
        String(plan.sourceFrames.length),
        "-an",
        "-c:v",
        "libx264",
        "-preset",
        "medium",
        "-crf",
        "18",
        "-threads",
        "2",
        "-pix_fmt",
        "yuv420p",
        "-color_range",
        "pc",
        "-colorspace",
        "bt470bg",
        "-r",
        "30",
        "-video_track_timescale",
        "90000",
        "-map_metadata",
        "-1",
        "-movflags",
        "+faststart",
        options.outputLocation,
      ],
      { timeoutMs: 120000, cancelled: isCancelled },
    );
    check();
    options.onProgress(1);
  } catch (error) {
    if (
      error instanceof CommandCancelledError ||
      error instanceof CommandTimeoutError
    )
      throw error;
    throw new Error("Video compositing could not finish safely.");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
