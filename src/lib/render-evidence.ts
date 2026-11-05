import { copyFile, rename, rm } from "node:fs/promises";
import path from "node:path";
import { totalFrames, type Timeline } from "./schema";
import { runCommand, CommandCancelledError } from "./process";

export function encodedEvidenceTargets(timeline: Timeline) {
  let start = 0;
  const samples: { sceneId: string; frame: number; file: string }[] = [];
  for (const [index, scene] of timeline.scenes.entries()) {
    const events = [
      ...new Set([
        ...scene.layers.flatMap((layer) =>
          (layer.keyframes || []).map((key) => key.frame),
        ),
        ...(scene.camera || []).map((key) => key.frame),
      ]),
    ].slice(0, 8);
    for (const [label, offset] of [
      ["begin", Math.min(10, scene.durationFrames - 1)],
      ["middle", Math.floor(scene.durationFrames / 2)],
      ["end", Math.max(0, scene.durationFrames - 11)],
      ...events.map((frame) => [`event-${frame}`, frame] as const),
    ] as const)
      samples.push({
        sceneId: scene.id,
        frame: start + offset,
        file: `scene-${index + 1}-${label}.png`,
      });
    start += scene.durationFrames;
  }
  return {
    samples,
    targets: [
      ...samples,
      { frame: Math.min(25, totalFrames(timeline) - 1), file: "thumbnail.png" },
      // Read through the final frame; the decoder runs all the way to EOF.
      { frame: totalFrames(timeline) - 1, file: "verification-tail.png" },
    ],
  };
}

// One complete error-checking decode produces actual encoded review frames.
// It replaces both a separate full decode and repeated browser still renders.
export async function captureEncodedEvidence(
  timeline: Timeline,
  video: string,
  directory: string,
  cancelled: () => boolean,
) {
  const { samples, targets } = encodedEvidenceTargets(timeline);
  const frames = [...new Set(targets.map((target) => target.frame))].sort(
    (a, b) => a - b,
  );
  const intermediate = (index: number) =>
    path.join(
      directory,
      `encoded-frame-${String(index + 1).padStart(4, "0")}.png`,
    );
  try {
    await runCommand(
      "ffmpeg",
      [
        "-v",
        "error",
        "-xerror",
        "-y",
        "-threads",
        "2",
        "-filter_threads",
        "1",
        "-i",
        video,
        "-an",
        "-vf",
        `select=${frames.map((frame) => `eq(n\\,${frame})`).join("+")}`,
        "-fps_mode",
        "passthrough",
        "-compression_level",
        "2",
        "-threads",
        "2",
        "-map_metadata",
        "-1",
        path.join(directory, "encoded-frame-%04d.png"),
      ],
      { timeoutMs: 120000, cancelled },
    );
    for (const [index, frame] of frames.entries()) {
      if (cancelled()) throw new CommandCancelledError();
      const group = targets.filter((target) => target.frame === frame);
      const first = path.join(directory, group[0].file);
      await rename(intermediate(index), first);
      // Keep independent regular evidence files, including coincident samples.
      for (const target of group.slice(1))
        await copyFile(first, path.join(directory, target.file));
    }
    return samples;
  } finally {
    for (let index = 0; index < frames.length; index++)
      await rm(intermediate(index), { force: true });
  }
}
