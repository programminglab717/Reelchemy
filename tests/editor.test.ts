import { test } from "node:test";
import assert from "node:assert/strict";
import {
  blankTimeline,
  editHistory,
  type EditHistory,
} from "../src/lib/editor";
import { timelineSchema, totalFrames } from "../src/lib/schema";
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
