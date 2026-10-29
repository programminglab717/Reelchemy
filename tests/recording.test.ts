import { test } from "node:test";
import assert from "node:assert/strict";
import { encodeRecording } from "../src/lib/recording";
import { pcmPeaks, waveformBars } from "../src/lib/waveform-math";
import { readWaveform } from "../src/lib/waveform";
import { storeAudio, probeMedia } from "../src/lib/audio";
import { assetDir } from "../src/lib/assets";
import { unlink } from "node:fs/promises";
import path from "node:path";

test("microphone PCM becomes a bounded mono WAV with finite clamped samples", () => {
  const samples = new Float32Array(4800);
  samples.set([-2, -1, 0, 0.5, 1, 2, NaN]);
  const view = new DataView(
    encodeRecording([samples.subarray(0, 30), samples.subarray(30)], 48000),
  );
  assert.equal(view.byteLength, 44 + samples.length * 2);
  assert.equal(view.getUint32(24, true), 48000);
  assert.equal(view.getUint16(22, true), 1);
  assert.deepEqual(
    Array.from({ length: 7 }, (_, i) => view.getInt16(44 + i * 2, true)),
    [-32768, -32768, 0, 16384, 32767, 32767, 0],
  );
  assert.throws(() => encodeRecording([], 48000));
  assert.throws(() => encodeRecording([new Float32Array(48000 * 61)], 48000));
  assert.throws(() => encodeRecording([samples], 192000));
});
test("waveform range/gain preserves source timing, peaks and quiet inputs", () => {
  const samples = new Int16Array(24000);
  samples.fill(16384, 8000, 16000);
  const wave = pcmPeaks(samples, 8000);
  assert.equal(wave.peaks.length, 90);
  assert(wave.peaks.slice(0, 30).every((p) => p === 0));
  assert(wave.peaks.slice(30, 60).every((p) => p === 0.5));
  assert(wave.peaks.slice(60).every((p) => p === 0));
  assert(waveformBars(wave, 30, 30, 0.5).every((p) => p === 0.25));
  assert(waveformBars(wave, 0, 90, 0).every((p) => p === 0));
  assert.equal(Math.max(...waveformBars(wave, 0, 90, 1, 3)), 0.5);
});
test("recorded WAV ingests through real FFmpeg and produces aligned source waveforms", async () => {
  const samples = new Float32Array(48000 * 3);
  for (let i = 48000; i < 96000; i++)
    samples[i] = Math.sin((i * 2 * Math.PI * 440) / 48000) * 0.3;
  const asset = await storeAudio(
    Buffer.from(encodeRecording([samples], 48000)),
    "Narration.wav",
    "Synthetic owned test",
  );
  try {
    const meta = probeMedia(path.join(assetDir, asset.id));
    assert.equal(meta.streams[0].codec_name, "pcm_s16le");
    assert.equal(asset.durationFrames, 90);
    const [wave, same] = await Promise.all([
      readWaveform(asset.id),
      readWaveform(asset.id),
    ]);
    assert.deepEqual(wave, same);
    assert(wave.peaks.slice(0, 29).every((p) => p < 0.001));
    assert(wave.peaks.slice(31, 59).every((p) => p > 0.2));
    assert(wave.peaks.slice(61).every((p) => p < 0.001));
    await assert.rejects(() => readWaveform("../../private"));
  } finally {
    await unlink(path.join(assetDir, asset.id));
  }
});

test("capture worklet flushes exact capped samples and releases partial buffers on stop", async () => {
  const { readFile } = await import("node:fs/promises");
  const { runInNewContext } = await import("node:vm");
  const messages: { type: string; chunk?: Float32Array }[] = [];
  let Processor: new (options: { processorOptions: { maxFrames: number } }) => {
    process: (samples: Float32Array[][]) => boolean;
    port: { onmessage: (event: { data: string }) => void };
  };
  runInNewContext(await readFile("public/narration-worklet.js", "utf8"), {
    Float32Array,
    AudioWorkletProcessor: class {
      port = {
        postMessage: (message: { type: string; chunk?: Float32Array }) =>
          messages.push(message),
        onmessage: null,
      };
    },
    registerProcessor: (_name: string, ctor: typeof Processor) => {
      Processor = ctor;
    },
  });
  const capture = new Processor!({ processorOptions: { maxFrames: 130 } });
  assert.equal(capture.process([[new Float32Array(128).fill(0.5)]]), true);
  assert.equal(capture.process([[new Float32Array(128).fill(0.5)]]), false);
  assert.deepEqual(
    messages.map((m) => m.type),
    ["samples", "done"],
  );
  assert.equal(messages[0].chunk?.length, 130);
  capture.port.onmessage({ data: "stop" });
  assert.equal(messages.length, 2);
  messages.length = 0;
  const stopped = new Processor!({ processorOptions: { maxFrames: 48000 } });
  stopped.process([[new Float32Array(128)]]);
  stopped.port.onmessage({ data: "stop" });
  assert.equal(messages[0].chunk?.length, 128);
  assert.equal(messages[1].type, "done");
});
