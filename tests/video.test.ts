import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { blankTimeline } from "../src/lib/editor";
import { splitScene } from "../src/lib/timeline-edit";
import type { Project } from "../src/lib/schema";
process.env.REELCHEMY_DATA_DIR = await mkdtemp(
  path.join(tmpdir(), "reelchemy-video-test-data-"),
);
const { storeVideo } = await import("../src/lib/video");
const { assetDir, resolveAssetSources, validateProjectAssets } =
  await import("../src/lib/assets");
const { probeMedia, muxAudio } = await import("../src/lib/audio");
const { exportArchive, importArchive } = await import("../src/lib/archive");
const { serveVideoAssets } = await import("../src/lib/video-server");
const { sceneCacheKey } = await import("../src/lib/render-cache");
test("a clip with a delayed source audio stream keeps its silence before the tone", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "reelchemy-delayed-audio-"));
  try {
    const source = path.join(dir, "delayed.mp4"),
      output = path.join(dir, "video.mp4");
    execFileSync("ffmpeg", [
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "color=black:size=160x90:rate=30:duration=4",
      "-itsoffset",
      "0.5",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=880:duration=2",
      "-map",
      "0:v",
      "-map",
      "1:a",
      "-c:v",
      "libx264",
      "-threads",
      "1",
      "-c:a",
      "aac",
      source,
    ]);
    const asset = await storeVideo(
      await readFile(source),
      "delayed.mp4",
      "Owned test",
    );
    execFileSync("ffmpeg", [
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "color=black:size=160x90:rate=30:duration=5",
      "-c:v",
      "libx264",
      "-threads",
      "1",
      output,
    ]);
    const t = blankTimeline({
      prompt: "Delay",
      duration: 5,
      format: "landscape",
    });
    t.scenes[0].layers = [
      {
        ...t.scenes[0].layers[0],
        kind: "video",
        assetId: asset.id,
        video: {
          startFrame: 0,
          offsetFrames: 0,
          durationFrames: 120,
          volume: 1,
          audio: true,
          fit: "contain",
        },
      },
    ];
    await muxAudio(t, output);
    const pcm = execFileSync(
      "ffmpeg",
      [
        "-v",
        "error",
        "-i",
        output,
        "-vn",
        "-ar",
        "48000",
        "-ac",
        "1",
        "-f",
        "f32le",
        "-",
      ],
      { maxBuffer: 2000000 },
    );
    const rms = (start: number, end: number) => {
      let sum = 0;
      for (let i = Math.floor(start * 48000); i < Math.floor(end * 48000); i++)
        sum += pcm.readFloatLE(i * 4) ** 2;
      return Math.sqrt(sum / ((end - start) * 48000));
    };
    assert(rms(0.1, 0.3) < 0.0001, "audio must retain its leading silence");
    assert(rms(0.8, 1.5) > 0.01, "the delayed tone must still be present");
    assert(
      rms(3, 4.5) < 0.0001,
      "source audio must end before the remaining video silence",
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test("silent portrait WebM is accepted and long input is rejected before normalization", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "reelchemy-webm-fixture-"));
  try {
    const file = path.join(dir, "portrait.webm");
    execFileSync("ffmpeg", [
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "testsrc2=size=90x160:rate=15:duration=1",
      "-c:v",
      "libvpx-vp9",
      "-threads",
      "1",
      file,
    ]);
    const asset = await storeVideo(
      await readFile(file),
      "portrait.webm",
      "Owned",
    );
    assert.equal(asset.hasAudio, false);
    assert.equal(asset.durationFrames, 30);
    assert(asset.height! > asset.width!);
    const long = path.join(dir, "long.mp4");
    execFileSync("ffmpeg", [
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "color=black:size=16x16:rate=1:duration=121",
      "-c:v",
      "libx264",
      "-threads",
      "1",
      long,
    ]);
    const bytes = await readFile(long);
    await assert.rejects(
      () => storeVideo(bytes, "long.mp4", "Owned"),
      /120 seconds/,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test("real footage is normalized, bounded, resolved locally and round trips with clip ranges/audio", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "reelchemy-video-fixture-"));
  try {
    const file = path.join(dir, "source.mp4");
    execFileSync("ffmpeg", [
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "testsrc2=size=160x90:rate=24:duration=2",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=880:duration=2",
      "-c:v",
      "libx264",
      "-threads",
      "1",
      "-c:a",
      "aac",
      "-shortest",
      file,
    ]);
    const bytes = await readFile(file),
      asset = await storeVideo(bytes, "../../footage.mp4", "Owned footage");
    assert.equal(asset.name, "footage.mp4");
    assert.equal(asset.durationFrames, 60);
    assert.equal(asset.hasAudio, true);
    const probe = probeMedia(path.join(assetDir, asset.id));
    assert.equal(probe.streams[0].r_frame_rate, "30/1");
    assert.equal(probe.streams[0].codec_name, "h264");
    const brief = {
        prompt: "Footage",
        duration: 5,
        format: "landscape" as const,
      },
      timeline = blankTimeline(brief);
    timeline.scenes[0].layers = [
      {
        ...timeline.scenes[0].layers[0],
        kind: "video",
        assetId: asset.id,
        video: {
          startFrame: 30,
          offsetFrames: 15,
          durationFrames: 45,
          volume: 0.6,
          audio: true,
          fit: "contain",
        },
      },
    ];
    const p: Project = {
      id: crypto.randomUUID(),
      name: "Footage",
      brief,
      timeline: splitScene(timeline, 0, 60),
      assets: [asset],
      revisions: [],
      messages: [],
      createdAt: new Date().toISOString(),
    };
    validateProjectAssets(p, p.timeline!);
    const sources = await resolveAssetSources(p.timeline!);
    assert.equal(sources[asset.id], `local-video:${asset.id}`);
    const serving = await serveVideoAssets(p.timeline!, sources);
    const another = await serveVideoAssets(p.timeline!, sources);
    const url = serving.sources[asset.id];
    try {
      assert.equal(new URL(url).hostname, "127.0.0.1");
      assert.notEqual(url, another.sources[asset.id]);
      const partial = await fetch(url, { headers: { Range: "bytes=0-31" } });
      assert.equal(partial.status, 206);
      assert.equal((await partial.arrayBuffer()).byteLength, 32);
      assert.equal(
        (await fetch(url.replace(asset.id, crypto.randomUUID()))).status,
        404,
      );
      assert.equal((await fetch(new URL("/wrong", url))).status, 404);
      assert.equal(
        sceneCacheKey(
          p.timeline!,
          serving.sources,
          "test",
          serving.fingerprints,
        ),
        sceneCacheKey(
          p.timeline!,
          another.sources,
          "test",
          another.fingerprints,
        ),
      );
    } finally {
      await serving.close();
      await another.close();
    }
    await assert.rejects(() =>
      fetch(url, { signal: AbortSignal.timeout(2000) }),
    );
    const restored = await importArchive(await exportArchive(p));
    assert.notEqual(restored.assets![0].id, asset.id);
    assert.equal(restored.assets![0].hasAudio, true);
    assert.equal(
      restored.timeline!.scenes[1].layers[0].video!.offsetFrames,
      45,
    );
    assert.equal(
      restored.timeline!.scenes[1].layers[0].assetId,
      restored.assets![0].id,
    );
    const invalid = structuredClone(p.timeline!);
    invalid.scenes[0].layers[0].video!.offsetFrames = 59;
    assert.throws(() => validateProjectAssets(p, invalid), /trim exceeds/);
    invalid.scenes[0].layers[0].assetId = crypto.randomUUID();
    assert.throws(() => validateProjectAssets(p, invalid), /belong/);
    await assert.rejects(
      () =>
        storeVideo(Buffer.alloc(25 * 1024 * 1024 + 1), "large.mp4", "Owned"),
      /25 MB/,
    );
    await assert.rejects(() =>
      storeVideo(Buffer.from("not video"), "fake.mp4", "Owned"),
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
