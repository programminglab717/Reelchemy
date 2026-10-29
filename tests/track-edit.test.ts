import { test } from "node:test";
import assert from "node:assert/strict";
import { editTrack } from "../src/lib/track-edit";
test("moving and trimming media preserves source frames and clamps to both scene and source", () => {
  const r = { startFrame: 30, offsetFrames: 15, durationFrames: 60 },
    b = { minFrame: 0, maxFrame: 150, sourceFrames: 120 };
  assert.deepEqual(editTrack(r, 10, "move", b), { ...r, startFrame: 40 });
  assert.deepEqual(editTrack(r, -100, "move", b), { ...r, startFrame: 0 });
  assert.deepEqual(editTrack(r, 500, "move", b), { ...r, startFrame: 90 });
  assert.deepEqual(editTrack(r, 10, "start", b), {
    startFrame: 40,
    offsetFrames: 25,
    durationFrames: 50,
  });
  assert.deepEqual(editTrack(r, -100, "start", b), {
    startFrame: 15,
    offsetFrames: 0,
    durationFrames: 75,
  });
  assert.deepEqual(editTrack(r, 500, "start", b), {
    startFrame: 89,
    offsetFrames: 74,
    durationFrames: 1,
  });
  assert.deepEqual(editTrack(r, 500, "end", b), { ...r, durationFrames: 105 });
  assert.deepEqual(editTrack(r, -500, "end", b), { ...r, durationFrames: 1 });
  assert.equal(editTrack(r, 10.49, "move", b).startFrame, 40);
  assert.equal(editTrack(r, 10.51, "move", b).startFrame, 41);
});
test("caption edits remain between adjacent cues and never produce negative source offsets", () => {
  const r = { startFrame: 45, offsetFrames: 0, durationFrames: 15 },
    b = { minFrame: 15, maxFrame: 100 };
  assert.deepEqual(editTrack(r, -100, "move", b), { ...r, startFrame: 15 });
  assert.deepEqual(editTrack(r, -100, "start", b), {
    startFrame: 15,
    offsetFrames: 0,
    durationFrames: 45,
  });
  assert.deepEqual(editTrack(r, 100, "end", b), { ...r, durationFrames: 55 });
});
