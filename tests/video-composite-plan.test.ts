import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { blankTimeline } from "../src/lib/editor";
import { videoCompositePlan } from "../src/lib/video-composite-plan";
import type { Timeline } from "../src/lib/schema";

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
      t.captions = Array.from({ length: 10 }, (_, i) => ({
        id: `cue-${i}`,
        text: "Dense",
        startFrame: i * 10,
        endFrame: i * 10 + 5,
      }));
    },
    (t) => {
      t.scenes[0].durationFrames = 60;
      t.captions = [];
    },
  ];
  for (const mutate of mutations) {
    const timeline = fixture();
    mutate(timeline);
    assert.equal(videoCompositePlan(timeline), null);
  }
});
