import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { blankTimeline, editHistory } from "../src/lib/editor";
import { timelineSchema, videoDimensions } from "../src/lib/schema";
import { splitScene } from "../src/lib/timeline-edit";
import { localSceneTimeline, sceneCacheKey } from "../src/lib/render-cache";
import { exportArchive, importArchive } from "../src/lib/archive";
import { unzipSync, zipSync, strFromU8, strToU8 } from "fflate";

test("legacy export dimensions stay unchanged; full HD survives editing, scene-local rendering, cache keys and portability", async () => {
  for (const format of ["landscape", "portrait", "square"] as const) {
    const brief = { prompt: "Resolution preservation", duration: 5, format };
    const original = blankTimeline(brief);
    const legacy = {
      landscape: { width: 1280, height: 720 },
      portrait: { width: 720, height: 1280 },
      square: { width: 1080, height: 1080 },
    };
    const hd = {
      landscape: { width: 1920, height: 1080 },
      portrait: { width: 1080, height: 1920 },
      square: { width: 1080, height: 1080 },
    };
    assert.deepEqual(videoDimensions(original), legacy[format]);
    const timeline = timelineSchema.parse({
      ...original,
      exportResolution: "1080p",
    });
    assert.deepEqual(videoDimensions(timeline), hd[format]);
    const history = editHistory(
      { past: [], present: original, future: [] },
      timeline,
    );
    assert.deepEqual(editHistory(history, "undo").present, original);
    assert.deepEqual(
      editHistory(editHistory(history, "undo"), "redo").present,
      timeline,
    );
    const split = splitScene(timeline, 0, 60);
    assert.equal(split.exportResolution, "1080p");
    assert.equal(localSceneTimeline(split, 1).exportResolution, "1080p");
    assert.notEqual(
      sceneCacheKey(original, {}, "fixture"),
      sceneCacheKey(timeline, {}, "fixture"),
    );
    const project = {
      id: randomUUID(),
      name: "Private HD fixture",
      brief,
      timeline,
      revisions: [
        {
          id: randomUUID(),
          createdAt: new Date().toISOString(),
          source: "manual",
          timeline,
        },
      ],
      messages: [],
      assets: [],
      createdAt: new Date().toISOString(),
    };
    const imported = await importArchive(await exportArchive(project));
    assert.equal(imported.timeline?.exportResolution, "1080p");
    assert.equal(imported.revisions[0].timeline.exportResolution, "1080p");
  }
});

test("unbounded or unknown export resolutions are rejected by the actual timeline contract", () => {
  const timeline = blankTimeline({
    prompt: "Bounded export",
    duration: 5,
    format: "landscape",
  });
  for (const exportResolution of [
    "4k",
    "1920x1080",
    1080,
    { width: 99999 },
    null,
  ])
    assert.equal(
      timelineSchema.safeParse({ ...timeline, exportResolution }).success,
      false,
    );
});

test("HD in retained versions requires archive v4 and preserves large history and rotation; retagging is refused", async () => {
  const brief = {
    prompt: "Portable native HD history",
    duration: 5,
    format: "landscape" as const,
  };
  const standard = blankTimeline(brief);
  const hd = timelineSchema.parse({ ...standard, exportResolution: "1080p" });
  hd.scenes[0].layers[0].rotation = 15;
  const project = {
    id: randomUUID(),
    name: "Versioned HD fixture",
    brief,
    timeline: standard,
    revisions: Array.from({ length: 501 }, (_, i) => ({
      id: randomUUID(),
      createdAt: new Date().toISOString(),
      source: "manual",
      timeline: i === 500 ? hd : standard,
    })),
    messages: [],
    assets: [],
    createdAt: new Date().toISOString(),
  };
  const files = unzipSync(await exportArchive(project));
  const envelope = JSON.parse(strFromU8(files["project.json"]));
  assert.equal(envelope.version, 4);
  assert.deepEqual(envelope.requiredFeatures, [
    "native-hd-v1",
    "large-history-v1",
    "layer-rotation-v1",
  ]);
  const imported = await importArchive(zipSync(files));
  assert.equal(imported.revisions.length, 501);
  assert.equal(imported.timeline?.exportResolution, undefined);
  assert.equal(imported.revisions.at(-1)?.timeline.exportResolution, "1080p");
  assert.equal(
    imported.revisions.at(-1)?.timeline.scenes[0].layers[0].rotation,
    15,
  );
  // Version 3 understands history/rotation but would drop native-HD semantics.
  envelope.version = 3;
  envelope.requiredFeatures = ["large-history-v1", "layer-rotation-v1"];
  files["project.json"] = strToU8(JSON.stringify(envelope));
  await assert.rejects(() => importArchive(zipSync(files)), /Native HD/);
  envelope.version = 4;
  envelope.requiredFeatures = ["native-hd-v1"];
  files["project.json"] = strToU8(JSON.stringify(envelope));
  await assert.rejects(
    () => importArchive(zipSync(files)),
    /features do not match/,
  );
});
