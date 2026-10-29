import { test } from "node:test";
import assert from "node:assert/strict";
import { blankTimeline, editHistory } from "../src/lib/editor";
import { layerSchema, timelineSchema } from "../src/lib/schema";
import { textStyle } from "../src/lib/text-style";
import { splitScene } from "../src/lib/timeline-edit";
import { exportArchive, importArchive } from "../src/lib/archive";

test("typography retains legacy defaults and scales type/letter spacing to output geometry", () => {
  const layer = blankTimeline({
    prompt: "Type",
    duration: 5,
    format: "landscape",
  }).scenes[0].layers[0];
  assert.equal(textStyle(layer, 1280).fontWeight, 700);
  assert.equal(textStyle({ ...layer, fontSize: 20 }, 1280).fontWeight, 500);
  const styled = {
    ...layer,
    fontFamily: "mono" as const,
    fontWeight: "regular" as const,
    fontSize: 60,
    lineHeight: 1.8,
    letterSpacing: 4,
    italic: true,
    underline: true,
    textAlign: "center" as const,
  };
  assert.equal(textStyle(styled, 720).fontSize, 33.75);
  assert.equal(textStyle(styled, 720).letterSpacing, 2.25);
  assert.equal(textStyle(styled, 720).lineHeight, 1.8);
  assert.equal(textStyle(styled, 720).fontWeight, 400);
  assert.equal(textStyle(styled, 720).fontStyle, "italic");
  for (const invalid of [
    { fontFamily: "https://remote.invalid/font" },
    { fontWeight: "unbounded" },
    { letterSpacing: 9 },
    { lineHeight: 0.5 },
  ])
    assert.equal(
      layerSchema.safeParse({ ...layer, ...invalid }).success,
      false,
    );
});
test("typography survives undo, scene splitting and portable project round trip", async () => {
  const brief = {
    prompt: "Portable typography",
    duration: 5,
    format: "landscape" as const,
  };
  const original = blankTimeline(brief),
    next = structuredClone(original);
  const fields = {
    fontFamily: "serif" as const,
    fontWeight: "heavy" as const,
    textAlign: "right" as const,
    lineHeight: 1.5,
    letterSpacing: -1,
    italic: true,
    underline: true,
  };
  Object.assign(next.scenes[0].layers[0], fields);
  const changed = editHistory(
    { past: [], present: original, future: [] },
    next,
  );
  assert.deepEqual(editHistory(changed, "undo").present, original);
  const split = splitScene(timelineSchema.parse(next), 0, 60);
  for (const scene of split.scenes)
    for (const [key, value] of Object.entries(fields))
      assert.equal(scene.layers[0][key as keyof typeof fields], value);
  const p = {
    id: crypto.randomUUID(),
    name: "Type",
    brief,
    timeline: split,
    revisions: [
      {
        id: crypto.randomUUID(),
        createdAt: new Date().toISOString(),
        source: "Type test",
        timeline: split,
      },
    ],
    messages: [],
    createdAt: new Date().toISOString(),
  };
  const imported = await importArchive(await exportArchive(p));
  assert.deepEqual(imported.timeline, JSON.parse(JSON.stringify(p.timeline)));
  assert.deepEqual(
    imported.revisions[0].timeline,
    JSON.parse(JSON.stringify(split)),
  );
});

test("Chromium reports horizontal glyph clipping from wide tracking in narrow text boxes", async () => {
  const { checkLayout } = await import("../src/lib/layout-qc");
  const { mkdtemp, rm } = await import("node:fs/promises");
  const path = await import("node:path");
  const { tmpdir } = await import("node:os");
  const directory = await mkdtemp(
    path.join(tmpdir(), "reelchemy-type-layout-"),
  );
  try {
    const t = blankTimeline({
      prompt: "Narrow type",
      duration: 5,
      format: "landscape",
    });
    t.scenes[0].layers[0] = {
      ...t.scenes[0].layers[0],
      text: "WWWW",
      fontSize: 12,
      letterSpacing: 8,
      width: 0.01,
      height: 0.5,
    };
    const report = await checkLayout(t, directory);
    assert(report.after.some((issue) => issue.code === "text-overflow"));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
