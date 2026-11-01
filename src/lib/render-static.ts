import { renderStill, type renderMedia } from "@remotion/renderer";
import { link, mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import type { Timeline } from "./schema";
import type { StaticScenePlan } from "./static-scene";
import type { RenderBrowser } from "./render-browser";
import { runCommand, CommandCancelledError } from "./process";

export async function renderStaticScene(options: {
  timeline: Timeline;
  plan: StaticScenePlan;
  composition: Parameters<typeof renderStill>[0]["composition"];
  serveUrl: string;
  assetSources: Record<string, string>;
  browserExecutable: string;
  puppeteerInstance: RenderBrowser;
  outputLocation: string;
  cancelSignal: Parameters<typeof renderMedia>[0]["cancelSignal"];
  isCancelled: () => boolean;
  onProgress: (progress: number) => void;
}) {
  const { plan, isCancelled } = options;
  const check = () => {
    if (isCancelled()) throw new CommandCancelledError();
  };
  check();
  const directory = await mkdtemp(
    path.join(path.dirname(options.outputLocation), "static-"),
  );
  const frameFile = (frame: number) =>
    path.join(directory, `frame-${String(frame).padStart(4, "0")}.jpeg`);
  try {
    for (const [index, frame] of plan.capturedFrames.entries()) {
      check();
      await renderStill({
        composition: options.composition,
        serveUrl: options.serveUrl,
        inputProps: {
          timeline: options.timeline,
          assetSources: options.assetSources,
        },
        browserExecutable: options.browserExecutable,
        puppeteerInstance: options.puppeteerInstance,
        output: frameFile(frame),
        frame,
        imageFormat: "jpeg",
        jpegQuality: 80,
        cancelSignal: options.cancelSignal,
        timeoutInMilliseconds: 60000,
      });
      options.onProgress((0.7 * (index + 1)) / plan.capturedFrames.length);
    }
    for (const [frame, source] of plan.sourceFrames.entries()) {
      check();
      if (frame !== source) await link(frameFile(source), frameFile(frame));
    }
    check();
    // Repeat immutable captures with hard links, then encode every requested
    // frame at 30 fps. No shortened video, duplicated file buffers, variable
    // timestamp guessing or extra audio mix is introduced.
    await runCommand(
      "ffmpeg",
      [
        "-v",
        "error",
        "-y",
        "-threads",
        "2",
        "-filter_threads",
        "1",
        "-f",
        "image2",
        "-framerate",
        "30",
        "-i",
        path.join(directory, "frame-%04d.jpeg"),
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
        "-vf",
        "scale=in_range=pc:out_range=pc",
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
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
