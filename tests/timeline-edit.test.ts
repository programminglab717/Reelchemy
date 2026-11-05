import { test } from "node:test";
import assert from "node:assert/strict";
import { blankTimeline } from "../src/lib/editor";
import { splitScene, sliceKeys } from "../src/lib/timeline-edit";
import {
  layerMotion,
  keyframeMotion,
  totalFrames,
  type Timeline,
  timelineSchema,
} from "../src/lib/schema";
import { clipAudioTracks } from "../src/lib/clip-audio";
import { byteRange } from "../src/lib/media-range";
const base = () =>
  blankTimeline({ prompt: "Split", duration: 5, format: "landscape" });
test("accepted motion-phase boundaries stay valid after repeated splits", () => {
  const t = base();
  t.scenes[0].motionOffsetFrames = 8850;
  assert(timelineSchema.safeParse(t).success);
  const cut = splitScene(splitScene(t, 0, 30), 1, 30);
  assert(timelineSchema.safeParse(cut).success);
  t.scenes[0].motionOffsetFrames = 8851;
  assert.equal(timelineSchema.safeParse(t).success, false);
});
const keys = [
  { frame: 20, x: 0, y: 0.1, scale: 1, opacity: 1 },
  { frame: 100, x: 0.1, y: 0, scale: 1.1, opacity: 0.9 },
];
function near(a: object, b: object) {
  for (const [k, v] of Object.entries(a))
    assert(
      Math.abs(v - (b as Record<string, number>)[k]) < 1e-10,
      `${k}: ${v}`,
    );
}
test("splitting preserves custom/preset/camera poses at every frame and keeps outer fades", () => {
  const t = base();
  t.scenes[0].transition = "fade";
  t.scenes[0].camera = keys;
  t.scenes[0].layers[0].keyframes = keys;
  t.scenes[0].layers.push({
    ...t.scenes[0].layers[0],
    id: "preset",
    keyframes: undefined,
    animation: "drift",
  });
  const snapshot = structuredClone(t),
    next = splitScene(t, 0, 60);
  assert.equal(totalFrames(next), totalFrames(t));
  assert.deepEqual(t, snapshot);
  assert.notEqual(next.scenes[0].id, next.scenes[1].id);
  assert.equal(next.scenes[0].fadeOut, false);
  assert.equal(next.scenes[1].fadeIn, false);
  for (let f = 0; f < 150; f++) {
    const scene = next.scenes[f < 60 ? 0 : 1],
      local = f < 60 ? f : f - 60;
    near(keyframeMotion(scene.camera!, local), keyframeMotion(keys, f));
    scene.layers.forEach((l, i) =>
      near(
        layerMotion(
          l,
          l.keyframes?.length ? local : local + (scene.motionOffsetFrames || 0),
        ),
        layerMotion(t.scenes[0].layers[i], f),
      ),
    );
  }
  const twice = splitScene(next, 1, 40);
  assert.equal(twice.scenes[2].motionOffsetFrames, 100);
  assert.equal(totalFrames(twice), 150);
});
test("slice boundaries preserve held/interpolated poses and never exceed 30 keys", () => {
  for (const start of [0, 25, 60, 110])
    for (const end of [120, 150]) {
      const sliced = sliceKeys(keys, start, end)!;
      for (let f = start; f < end; f++)
        near(keyframeMotion(sliced, f - start), keyframeMotion(keys, f));
    }
  const dense = Array.from({ length: 30 }, (_, i) => ({
    frame: i * 5,
    x: i / 100,
    y: 0,
    scale: 1,
    opacity: 1,
  }));
  for (let a = 0; a < 100; a++)
    for (let b = a + 1; b < 150; b++)
      assert(sliceKeys(dense, a, b)!.length <= 30);
});
test("video splits retain exact source ranges, global sound and captions, including clip gaps", () => {
  const t = base();
  const id = crypto.randomUUID();
  t.scenes[0].layers = [
    {
      ...t.scenes[0].layers[0],
      kind: "video",
      assetId: id,
      video: {
        startFrame: 30,
        offsetFrames: 30,
        durationFrames: 60,
        volume: 0.5,
        audio: true,
        fit: "cover",
      },
    },
  ];
  t.captions = [
    { id: "cue", startFrame: 45, endFrame: 100, text: "Across cut" },
  ];
  const next = splitScene(t, 0, 60);
  assert.deepEqual(next.captions, t.captions);
  assert.deepEqual(
    next.scenes.map((s) => s.layers[0].video),
    [
      { ...t.scenes[0].layers[0].video!, durationFrames: 30 },
      {
        ...t.scenes[0].layers[0].video!,
        startFrame: 0,
        offsetFrames: 60,
        durationFrames: 30,
      },
    ],
  );
  const tracks = clipAudioTracks(next);
  assert.deepEqual(
    tracks.map((a) => [a.startFrame, a.offsetFrames, a.durationFrames]),
    [
      [30, 30, 30],
      [60, 60, 30],
    ],
  );
  const gap = splitScene(t, 0, 120);
  assert.equal(gap.scenes[1].layers.length, 0);
  next.scenes[0].layers[0].hidden = true;
  assert.equal(clipAudioTracks(next).length, 1);
});
test("invalid scene splits and invalid byte ranges are rejected", () => {
  for (const f of [-1, 0, 29, 121, 150, 30.5])
    assert.throws(() => splitScene(base(), 0, f));
  const t = base();
  t.scenes = Array.from({ length: 60 }, (_, i) => ({
    ...t.scenes[0],
    id: `s${i}`,
    durationFrames: 60,
  }));
  assert.throws(() => splitScene(t as Timeline, 0, 30), /60 scenes/);
  assert.equal(byteRange(null, 100), null);
  assert.deepEqual(byteRange("bytes=0-31", 100), { start: 0, end: 31 });
  assert.deepEqual(byteRange("bytes=50-", 100), { start: 50, end: 99 });
  assert.deepEqual(byteRange("bytes=-10", 100), { start: 90, end: 99 });
  assert.deepEqual(byteRange("bytes=90-999", 100), { start: 90, end: 99 });
  for (const r of [
    "bytes=100-",
    "bytes=-0",
    "bytes=3-2",
    "bytes=0-1,4-5",
    "bytes=-",
    "bytes=90071992547409920-",
  ])
    assert.throws(() => byteRange(r, 100));
});
