import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { checkLayout } from "../src/lib/layout-qc";
import { mockPlan } from "../src/lib/provider";
test("Chromium detects clipped text and localized repair fits it without changing other scenes", async () => {
  const t = mockPlan({ prompt: "Test", duration: 5, format: "landscape" });
  t.scenes[0].layers[1].text =
    "A long title that must fit into this measured box";
  t.scenes[0].layers[1].fontSize = 120;
  t.scenes[0].layers[1].height = 0.08;
  const r = await checkLayout(
    t,
    await mkdtemp(path.join(tmpdir(), "reelchemy-qc-")),
  );
  assert(r.before.some((i) => i.code === "text-overflow"));
  assert.equal(r.after.length, 0);
  assert(r.changes.length > 0);
  assert.deepEqual(r.timeline.scenes[1], t.scenes[1]);
});
test("layout cancellation before and during browser startup is bounded and keeps the next review usable", async () => {
  const t = mockPlan({
    prompt: "Cancelable layout",
    duration: 5,
    format: "landscape",
  });
  const output = await mkdtemp(path.join(tmpdir(), "reelchemy-layout-cancel-"));
  await assert.rejects(() => checkLayout(t, output, () => true), /cancelled/i);
  let checks = 0;
  await assert.rejects(
    () => checkLayout(t, output, () => ++checks >= 2),
    /cancelled/i,
  );
  assert(checks >= 2, "cancel after browser launch rather than only at entry");
  assert.equal((await checkLayout(t, output)).after.length, 0);
});
