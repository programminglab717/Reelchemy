import { test } from "node:test";
import assert from "node:assert/strict";
import {
  blankTimeline,
  editHistory,
  type EditHistory,
} from "../src/lib/editor";
import { timelineSchema, totalFrames } from "../src/lib/schema";
import { placeLayer } from "../src/lib/canvas";
import { inspectTimeline } from "../src/lib/qc";
test("blank manual projects meet requested duration and formats without a planner", () => {
  for (const duration of [5, 15, 30, 60])
    for (const format of ["landscape", "portrait", "square"] as const) {
      const t = blankTimeline({ prompt: "Manual", duration, format });
      assert(timelineSchema.safeParse(t).success);
      assert.equal(totalFrames(t), duration * 30);
      assert.equal(t.format, format);
      assert.equal(new Set(t.scenes.map((s) => s.id)).size, t.scenes.length);
    }
});
test("canvas placement clamps and snaps, keyboard movement stays precise, and locked layers do not move", () => {
  const layer = blankTimeline({
    prompt: "Canvas",
    duration: 5,
    format: "landscape",
  }).scenes[0].layers[0];
  assert.equal(placeLayer(layer, 10, -10).x, 0.2);
  assert.equal(placeLayer(layer, 10, -10).y, 0);
  assert.equal(placeLayer(layer, 0.005, 0).x, 0.1);
  assert.equal(placeLayer(layer, 0.005, 0, false, false).x, 0.105);
  const resized = placeLayer(layer, 4, -4, true);
  assert.equal(resized.width, 0.9);
  assert.equal(resized.height, 0.01);
  const locked = { ...layer, locked: true };
  assert.equal(placeLayer(locked, 0.1, 0.2), locked);
  assert.equal(placeLayer(locked, 0.1, 0.2, true), locked);
});
test("hidden layers do not generate visual layout warnings", () => {
  const t = blankTimeline({
    prompt: "Canvas",
    duration: 5,
    format: "landscape",
  });
  t.scenes[0].layers[0] = {
    ...t.scenes[0].layers[0],
    x: 0.99,
    hidden: true,
    color: t.scenes[0].background,
  };
  assert.deepEqual(inspectTimeline(t), []);
  t.scenes[0].layers[0].hidden = false;
  assert(inspectTimeline(t).some((i) => i.code === "bounds"));
  assert(inspectTimeline(t).some((i) => i.code === "contrast"));
});
test("undo/redo is reversible, clears a branched future, bounds history and rejects invalid edits", () => {
  const t = blankTimeline({
    prompt: "Manual",
    duration: 5,
    format: "landscape",
  });
  let h: EditHistory = { past: [], present: t, future: [] };
  const changed = structuredClone(t);
  changed.scenes[0].title = "Changed";
  h = editHistory(h, changed);
  const undone = editHistory(h, "undo");
  assert.deepEqual(undone.present, t);
  assert.deepEqual(editHistory(undone, "redo").present, changed);
  assert.equal(editHistory(undone, t), undone);
  assert.equal(
    editHistory(undone, { ...t, format: "square" }).future.length,
    0,
  );
  for (let i = 0; i < 80; i++)
    h = editHistory(h, {
      ...changed,
      scenes: [{ ...changed.scenes[0], title: `Edit ${i}` }],
    });
  assert.equal(h.past.length, 50);
  assert.throws(() => editHistory(h, { ...t, scenes: [] }));
  assert.equal(h.present.scenes[0].title, "Edit 79");
});
