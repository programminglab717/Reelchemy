import { test, expect } from "./fixtures";
import { encodedFrame } from "./media-frame";
import { encodeRecording } from "../../src/lib/recording";
import { randomBytes } from "node:crypto";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";

test("large normalized images and narration export exact first-frame pixels/audio and reuse scene clips across capabilities", async ({
  page,
  request,
}) => {
  test.setTimeout(360000);
  const p = await (
    await request.post("/api/projects", {
      data: {
        prompt: "Streamed mixed-media story",
        duration: 5,
        format: "landscape",
        blank: true,
      },
    })
  ).json();
  const images = [];
  for (const [index, color] of [
    [20, 235, 235],
    [235, 20, 235],
  ].entries()) {
    const pixels = randomBytes(768 * 768 * 3);
    for (let y = 256; y < 512; y++)
      for (let x = 256; x < 512; x++) pixels.set(color, (y * 768 + x) * 3);
    const source = await sharp(pixels, {
      raw: { width: 768, height: 768, channels: 3 },
    })
      .png()
      .toBuffer();
    expect(source.length).toBeGreaterThan(1024 * 1024);
    const uploaded = await request.post(`/api/projects/${p.id}/assets`, {
      multipart: {
        kind: "image",
        license: "Owned synthetic noise/picture",
        file: {
          name: `picture-${index}.png`,
          mimeType: "image/png",
          buffer: source,
        },
      },
    });
    expect(uploaded.status()).toBe(201);
    images.push((await uploaded.json()).assets[index]);
  }
  const samples = new Float32Array(48000 * 5);
  for (let i = 0; i < samples.length; i++)
    samples[i] = Math.sin((i * 2 * Math.PI * 440) / 48000) * 0.3;
  const uploaded = await request.post(`/api/projects/${p.id}/assets`, {
    multipart: {
      kind: "audio",
      license: "Owned synthetic voice track",
      file: {
        name: "voice.wav",
        mimeType: "audio/wav",
        buffer: Buffer.from(encodeRecording([samples], 48000)),
      },
    },
  });
  expect(uploaded.status()).toBe(201);
  const audio = (await uploaded.json()).assets[2];
  p.timeline.scenes = images.map((image, index) => ({
    ...p.timeline.scenes[0],
    id: `photo-${index}`,
    durationFrames: 75,
    transition: "cut",
    layers: [
      {
        ...p.timeline.scenes[0].layers[0],
        id: "picture",
        kind: "image",
        assetId: image.id,
        text: "",
        x: 0.1,
        y: 0.1,
        width: 0.8,
        height: 0.8,
        animation: "none",
        imageFit: "cover",
      },
    ],
  }));
  p.timeline.audioTracks = [
    {
      id: "narration",
      assetId: audio.id,
      startFrame: 30,
      offsetFrames: 0,
      durationFrames: 90,
      volume: 0.4,
      fadeFrames: 3,
    },
  ];
  expect(
    (
      await request.patch(`/api/projects/${p.id}`, {
        data: { timeline: p.timeline, baseRevisionId: p.revisions.at(-1).id },
      })
    ).status(),
  ).toBe(200);
  await page.goto("/");
  await page.getByRole("button", { name: p.name, exact: false }).click();
  async function exportVideo() {
    const response = page.waitForResponse(
      (r) =>
        r.url().endsWith(`/api/projects/${p.id}/render`) &&
        r.request().method() === "POST",
    );
    await page.getByRole("button", { name: "Approve & export MP4" }).click();
    const job = await (await response).json();
    await expect
      .poll(
        async () =>
          (await (await request.get(`/api/jobs/${job.id}`)).json()).status,
        { timeout: 200000, intervals: [1000] },
      )
      .toBe("completed");
    await expect(page.getByText("Your film is ready.")).toBeVisible();
    return (await request.get(`/api/jobs/${job.id}`)).json();
  }
  const first = await exportVideo();
  expect(
    first.report.sceneCache.map((s: { reused: boolean }) => s.reused),
  ).toEqual([false, false]);
  for (const [seconds, lowChannel] of [
    [0, 0],
    [3.5, 1],
  ]) {
    const frame = await encodedFrame(request, first.id, seconds);
    const pixel = (360 * frame.width + 640) * 3;
    expect(frame.data[pixel + lowChannel]).toBeLessThan(45);
    for (let c = 0; c < 3; c++)
      if (c !== lowChannel) expect(frame.data[pixel + c]).toBeGreaterThan(210);
  }
  const dir = await mkdtemp(path.join(tmpdir(), "reelchemy-streamed-audio-"));
  try {
    const file = path.join(dir, "film.mp4");
    await writeFile(
      file,
      await (await request.get(`/api/jobs/${first.id}/download`)).body(),
    );
    const pcm = execFileSync(
      "ffmpeg",
      [
        "-v",
        "error",
        "-i",
        file,
        "-vn",
        "-ar",
        "48000",
        "-ac",
        "1",
        "-f",
        "f32le",
        "-",
      ],
      { maxBuffer: 2000000, timeout: 30000 },
    );
    const rms = (start: number, end: number) => {
      let sum = 0;
      for (let i = Math.floor(start * 48000); i < Math.floor(end * 48000); i++)
        sum += pcm.readFloatLE(i * 4) ** 2;
      return Math.sqrt(sum / ((end - start) * 48000));
    };
    expect(rms(0.1, 0.7)).toBeLessThan(0.001);
    expect(rms(1.3, 3.7)).toBeGreaterThan(0.02);
    expect(rms(4.3, 4.8)).toBeLessThan(0.001);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
  const second = await exportVideo();
  expect(second.id).not.toBe(first.id);
  expect(
    second.report.sceneCache.map((s: { reused: boolean }) => s.reused),
  ).toEqual([true, true]);
  expect(second.report.qc.audio.tracks).toBe(1);
  expect(JSON.stringify(second.report)).not.toContain("http://127.0.0.1:");
});
