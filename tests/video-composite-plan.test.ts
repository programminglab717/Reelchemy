import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { blankTimeline } from "../src/lib/editor";
import { videoCompositePlan } from "../src/lib/video-composite-plan";
import type { Timeline } from "../src/lib/schema";
import { staticScenePlan } from "../src/lib/static-scene";
import { captionAt } from "../src/lib/captions";

function fixture() {
  const timeline = blankTimeline({
    prompt: "Composited footage",
    duration: 5,
    format: "landscape",
  });
  const base = timeline.scenes[0].layers[0];
  timeline.scenes[0].layers.push({
    ...base,
    id: "footage",
    kind: "video",
    assetId: randomUUID(),
    video: {
      startFrame: 15,
      offsetFrames: 30,
      durationFrames: 90,
      volume: 0.5,
      audio: true,
      fit: "contain",
    },
  });
  timeline.captions = [
    { id: "a", text: "First cue", startFrame: 0, endFrame: 30 },
    { id: "b", text: "Second cue", startFrame: 60, endFrame: 120 },
  ];
  return timeline;
}
test("footage compositing retains every frame/caption/source range without changing the timeline", () => {
  const timeline = fixture(),
    before = structuredClone(timeline);
  const plan = videoCompositePlan(timeline)!;
  assert(plan);
  assert.deepEqual(plan.capturedFrames, [0, 30, 60, 120]);
  assert.equal(plan.sourceFrames.length, 150);
  assert.deepEqual(plan.video.video, before.scenes[0].layers[1].video);
  assert.deepEqual(timeline, before);
  for (const [start, end, source] of [
    [0, 30, 0],
    [30, 60, 30],
    [60, 120, 60],
    [120, 150, 120],
  ])
    assert(
      plan.sourceFrames.slice(start, end).every((frame) => frame === source),
    );
});
test("transforms, continuous motion, multiple clips, fades/cameras and caption-heavy or short scenes keep ordinary rendering", () => {
  const mutations: ((t: Timeline) => void)[] = [
    (t) => {
      t.scenes[0].layers[1].rotation = 10;
    },
    (t) => {
      t.scenes[0].layers[1].animation = "rise";
    },
    (t) => {
      t.scenes[0].layers[0].kind = "nodes";
    },
    (t) => {
      t.scenes[0].layers[0].animation = "pulse";
    },
    (t) => {
      t.scenes[0].layers.push({ ...t.scenes[0].layers[1], id: "second" });
    },
    (t) => {
      t.scenes[0].transition = "fade";
    },
    (t) => {
      t.scenes[0].camera = [{ frame: 0, x: 0, y: 0, scale: 1, opacity: 1 }];
    },
    (t) => {
      t.scenes[0].layers[1].assetId = undefined;
    },
    (t) => {
      t.captions = Array.from({ length: 18 }, (_, i) => ({
        id: `cue-${i}`,
        text: "Dense",
        startFrame: i * 8,
        endFrame: i * 8 + 4,
      }));
    },
    (t) => {
      t.scenes[0].durationFrames = 60;
      t.captions = [];
    },
    // A shaped clip is clipped by the browser, not the FFmpeg overlay.
    (t) => {
      t.scenes[0].layers[1].mask = "circle";
    },
  ];
  for (const mutate of mutations) {
    const timeline = fixture();
    mutate(timeline);
    assert.equal(videoCompositePlan(timeline), null);
  }
});

test("bounded dense footage captions retain exact cue gaps without broadening ordinary still capture limits", () => {
  const timeline = fixture();
  timeline.captions = Array.from({ length: 14 }, (_, i) => ({
    id: `cue-${i}`,
    text: `Cue ${i + 1}`,
    startFrame: i * 10,
    endFrame: i * 10 + 8,
  }));
  const still = {
    ...timeline,
    scenes: [{ ...timeline.scenes[0], layers: [timeline.scenes[0].layers[0]] }],
  };
  assert.equal(staticScenePlan(still), null);
  const plan = videoCompositePlan(timeline)!;
  assert(
    plan && plan.capturedFrames.length > 8 && plan.capturedFrames.length <= 32,
  );
  for (let frame = 0; frame < 150; frame++)
    assert.deepEqual(
      captionAt(timeline, frame),
      captionAt(timeline, plan.sourceFrames[frame]),
    );
  for (const bound of [0, 33, NaN])
    assert.equal(staticScenePlan(still, bound), null);
});
