import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, readdir, stat, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import sharp from "sharp";
import { blankTimeline } from "../src/lib/editor";
import {
  captureEncodedEvidence,
  encodedEvidenceTargets,
} from "../src/lib/render-evidence";
import { CommandCancelledError } from "../src/lib/process";

test("encoded review frames retain exact scene/event boundaries, independent files and the final decoded frame", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "reelchemy-encoded-proof-"));
  try {
    const timeline = blankTimeline({
      prompt: "Encoded proof",
      duration: 5,
      format: "landscape",
    });
    const first = timeline.scenes[0];
    first.durationFrames = 30;
    first.camera = [
      { frame: 0, x: 0, y: 0, scale: 1, opacity: 1 },
      { frame: 29, x: 0, y: 0, scale: 1, opacity: 1 },
    ];
    timeline.scenes.push({ ...structuredClone(first), id: "second" });
    const plan = encodedEvidenceTargets(timeline);
    assert(
      plan.targets.every((target) => target.frame >= 0 && target.frame < 60),
    );
    assert.equal(plan.targets.at(-1)?.frame, 59);
    const movie = path.join(root, "movie.mp4"),
      output = path.join(root, "evidence");
    await mkdir(output);
    execFileSync(
      "ffmpeg",
      [
        "-v",
        "error",
        "-f",
        "lavfi",
        "-i",
        "color=red:size=64x64:rate=30:duration=1",
        "-f",
        "lavfi",
        "-i",
        "color=blue:size=64x64:rate=30:duration=1",
        "-filter_complex",
        "[0:v][1:v]concat=n=2:v=1:a=0[out]",
        "-map",
        "[out]",
        "-c:v",
        "libx264",
        "-threads",
        "2",
        "-pix_fmt",
        "yuv420p",
        movie,
      ],
      { timeout: 15000 },
    );
    const original = await readFile(movie);
    const samples = await captureEncodedEvidence(
      timeline,
      movie,
      output,
      () => false,
    );
    assert.deepEqual(samples, plan.samples);
    for (const target of plan.targets) {
      const file = path.join(output, target.file);
      assert.equal((await stat(file)).nlink, 1);
      const pixels = await sharp(file).removeAlpha().raw().toBuffer();
      const expected = target.frame < 30 ? 0 : 2;
      assert(
        pixels[expected] > 240,
        `${target.file} needs the correct encoded scene`,
      );
      assert(pixels[expected === 0 ? 2 : 0] < 10);
    }
    assert(
      !(await readdir(output)).some((name) =>
        name.startsWith("encoded-frame-"),
      ),
    );
    await assert.rejects(
      () => captureEncodedEvidence(timeline, movie, output, () => true),
      CommandCancelledError,
    );
    assert.deepEqual(await readFile(movie), original);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
