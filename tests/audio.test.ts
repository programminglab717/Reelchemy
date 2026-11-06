import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { storeAudio, muxAudio, probeMedia } from "../src/lib/audio";
import { audioGain } from "../src/lib/audio-math";
import { mockPlan } from "../src/lib/provider";
import { timelineSchema } from "../src/lib/schema";
import { captionAt, subtitles } from "../src/lib/captions";
test("frame-based captions reject overlap, fit timeline and escape exported text", () => {
  const t = mockPlan({
    prompt: "Audio test",
    duration: 5,
    format: "landscape",
  });
  t.captions = [
    { id: "c1", startFrame: 0, endFrame: 30, text: "<Hello>" },
    { id: "c2", startFrame: 30, endFrame: 60, text: "Second cue" },
  ];
  assert.equal(captionAt(t, 29)?.id, "c1");
  assert.equal(captionAt(t, 30)?.id, "c2");
  assert(
    subtitles(t, "srt").includes(
      "00:00:00,000 --> 00:00:01,000\n&lt;Hello&gt;",
    ),
  );
  assert(subtitles(t, "vtt").startsWith("WEBVTT"));
  t.captions[1].startFrame = 29;
  assert.equal(timelineSchema.safeParse(t).success, false);
});
test("real audio upload, delayed trim/mix, AAC duration and fade mathematics", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "reelchemy-audio-test-"));
  const source = path.join(dir, "tone.wav");
  execFileSync("ffmpeg", [
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=440:duration=3",
    source,
  ]);
  const asset = await storeAudio(
    await readFile(source),
    "../../tone.wav",
    "Generated test signal",
  );
  assert.equal(asset.mime, "audio/wav");
  assert.equal(asset.name, "tone.wav");
  const video = path.join(dir, "video.mp4");
  execFileSync("ffmpeg", [
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "color=c=black:s=1280x720:r=30:d=5",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    video,
  ]);
  const t = mockPlan({ prompt: "Test", duration: 5, format: "landscape" });
  t.audioTracks = [
    {
      id: "track",
      assetId: asset.id,
      startFrame: 30,
      offsetFrames: 15,
      durationFrames: 60,
      volume: 0.5,
      fadeFrames: 6,
    },
  ];
  assert.equal(audioGain(t.audioTracks[0], 0), 0);
  assert.equal(audioGain(t.audioTracks[0], 6), 0.5);
  const report = await muxAudio(t, video);
  assert.equal(report.codec, "aac");
  assert(report.peakDb !== null && report.peakDb < 0);
  assert.equal(
    probeMedia(video).streams.find(
      (s: { codec_type: string }) => s.codec_type === "audio",
    ).sample_rate,
    "48000",
  );
  const raw = execFileSync(
    "ffmpeg",
    [
      "-v",
      "error",
      "-i",
      video,
      "-f",
      "f32le",
      "-ac",
      "1",
      "-ar",
      "48000",
      "pipe:1",
    ],
    { maxBuffer: 2000000 },
  );
  const floats = new Float32Array(
    raw.buffer,
    raw.byteOffset,
    raw.byteLength / 4,
  );
  const rms = (start: number, end: number) =>
    Math.sqrt(
      floats.slice(start * 48000, end * 48000).reduce((n, x) => n + x * x, 0) /
        ((end - start) * 48000),
    );
  assert(rms(0, 0.5) < 0.001);
  assert(rms(1.5, 2) > 0.005);
  assert(rms(4, 4.5) < 0.001);
  t.audioTracks[0].durationFrames = 180;
  await assert.rejects(() => muxAudio(t, video), /trim exceeds/);
  await assert.rejects(() =>
    storeAudio(Buffer.from("<html>invalid</html>"), "invalid.mp3", "Test"),
  );
});
test("a narration file longer than two minutes is kept whole and can be mixed from a late source offset", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "reelchemy-long-audio-"));
  const source = path.join(dir, "narration.mp3");
  // 240 s: silence, then a 1 kHz tone from 200 s.
  execFileSync("ffmpeg", [
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "aevalsrc=if(gte(t\\,200)\\,0.5*sin(2*PI*1000*t)\\,0):s=16000:d=240",
    "-ac",
    "1",
    "-b:a",
    "32k",
    source,
  ]);
  const asset = await storeAudio(
    await readFile(source),
    "narration.mp3",
    "Generated test narration",
  );
  assert(Math.abs(asset.durationFrames! - 7200) <= 2);
  const tooLong = path.join(dir, "too-long.mp3");
  execFileSync("ffmpeg", [
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "anullsrc=r=8000:cl=mono",
    "-t",
    "301",
    "-b:a",
    "16k",
    tooLong,
  ]);
  await assert.rejects(
    storeAudio(await readFile(tooLong), "too-long.mp3", "Generated"),
    /5 minutes/,
  );
  const video = path.join(dir, "video.mp4");
  execFileSync("ffmpeg", [
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "color=c=black:s=320x180:r=30:d=5",
    "-c:v",
    "libx264",
    "-threads",
    "1",
    "-pix_fmt",
    "yuv420p",
    video,
  ]);
  const timeline = timelineSchema.parse({
    ...mockPlan({ prompt: "Late narration", duration: 5, format: "landscape" }),
    audioTracks: [
      {
        id: "late",
        assetId: asset.id,
        startFrame: 0,
        offsetFrames: 6030,
        durationFrames: 150,
        volume: 1,
        fadeFrames: 0,
      },
    ],
  });
  const report = await muxAudio(timeline, video);
  assert.equal(report.codec, "aac");
  // The mixed window starts at 201 s of the source, inside the tone.
  assert(report.peakDb !== null && report.peakDb > -12, `${report.peakDb}`);
});
