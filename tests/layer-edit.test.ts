import { test } from "node:test";
import assert from "node:assert/strict";
import {
  blankTimeline,
  editHistory,
  type EditHistory,
} from "../src/lib/editor";
import { timelineSchema, keyframeMotion } from "../src/lib/schema";
import { duplicateLayer } from "../src/lib/layer-edit";

test("duplicated footage preserves exact frame poses, source/audio ranges and styling while later nested edits cannot change its source", () => {
  const timeline = blankTimeline({
    prompt: "Owned footage copy",
    duration: 5,
    format: "landscape",
  });
  const source = timeline.scenes[0].layers[0];
  Object.assign(source, {
    kind: "video",
    assetId: "11111111-1111-4111-8111-111111111111",
    rotation: 23,
    video: {
      startFrame: 10,
      offsetFrames: 45,
      durationFrames: 90,
      volume: 0.3,
      audio: true,
      fit: "cover",
    },
    mediaPosition: { x: 0.2, y: 0.7 },
    imageFit: "cover",
    fontFamily: "serif",
    fontWeight: "heavy",
    textAlign: "right",
    italic: true,
    underline: true,
    letterSpacing: 1.5,
    keyframes: [
      { frame: 0, x: 0, y: 0, scale: 1, opacity: 0.5 },
      { frame: 149, x: 0.2, y: 0.1, scale: 1.2, opacity: 1 },
    ],
  });
  const before = structuredClone(timeline),
    result = duplicateLayer(timeline, 0, source.id, "footage-copy"),
    copied = result.timeline.scenes[0].layers[1];
  assert.deepEqual(timeline, before);
  assert.deepEqual(copied, { ...source, id: "footage-copy" });
  assert(timelineSchema.safeParse(result.timeline).success);
  assert(source.keyframes && copied.keyframes);
  for (let frame = 0; frame < 150; frame++)
    assert.deepEqual(
      keyframeMotion(copied.keyframes, frame),
      keyframeMotion(source.keyframes, frame),
    );
  copied.keyframes![0].x = 0.5;
  copied.video!.offsetFrames = 50;
  copied.mediaPosition!.x = 0.9;
  assert.deepEqual(timeline, before);
});
test("duplication changes only the chosen scene, adds one undo command and survives redo with the same media reference", () => {
  const timeline = blankTimeline({
      prompt: "Layer undo",
      duration: 30,
      format: "landscape",
    }),
    original = structuredClone(timeline);
  const scene = timeline.scenes[1],
    id = scene.layers[0].id;
  const result = duplicateLayer(timeline, 1, id, "selected-copy");
  assert.equal(result.timeline.scenes[0], timeline.scenes[0]);
  assert.equal(
    result.timeline.scenes[1].layers[0],
    timeline.scenes[1].layers[0],
  );
  const history: EditHistory = { past: [], present: timeline, future: [] };
  const duplicated = editHistory(history, result.timeline);
  assert.equal(duplicated.past.length, 1);
  const undone = editHistory(duplicated, "undo");
  assert.deepEqual(undone.present, original);
  const redone = editHistory(undone, "redo");
  assert.deepEqual(redone.present, result.timeline);
});
test("locked, missing, full and duplicate-ID selections cannot change the timeline or exceed the existing layer bound", () => {
  const timeline = blankTimeline({
      prompt: "Layer limits",
      duration: 5,
      format: "landscape",
    }),
    source = timeline.scenes[0].layers[0];
  const original = structuredClone(timeline);
  assert.throws(() => duplicateLayer(timeline, 0, "missing"), /Select/);
  assert.throws(
    () => duplicateLayer(timeline, 0, source.id, source.id),
    /identifier/,
  );
  assert.throws(() => duplicateLayer(timeline, 0, source.id, ""), /identifier/);
  assert.deepEqual(timeline, original);
  source.locked = true;
  assert.throws(() => duplicateLayer(timeline, 0, source.id), /Unlock/);
  source.locked = false;
  timeline.scenes[0].layers = Array.from({ length: 20 }, (_, i) => ({
    ...source,
    id: `layer-${i}`,
  }));
  const full = structuredClone(timeline);
  assert.throws(() => duplicateLayer(timeline, 0, "layer-0"), /20 layers/);
  assert.deepEqual(timeline, full);
});
