import { test } from "node:test";
import assert from "node:assert/strict";
import { blankTimeline } from "../src/lib/editor";
import { layerCorners, polygonsOverlap } from "../src/lib/layer-geometry";
import { placeLayer } from "../src/lib/canvas";
import {
  layerSchema,
  timelineSchema,
  formats,
  type Layer,
  type Project,
} from "../src/lib/schema";
import { inspectTimeline, repairBounds } from "../src/lib/qc";
import { splitScene } from "../src/lib/timeline-edit";
import { exportArchive, importArchive } from "../src/lib/archive";
import { unzipSync, strFromU8, zipSync, strToU8 } from "fflate";
const brief = {
  prompt: "Rotated artwork",
  duration: 5,
  format: "landscape" as const,
};
const base: Layer = {
  ...blankTimeline(brief).scenes[0].layers[0],
  kind: "rectangle",
  text: "",
  x: 0.3,
  y: 0.3,
  width: 0.2,
  height: 0.2,
  animation: "none",
};
const near = (a: number, b: number, tolerance = 1e-7) =>
  assert(
    Math.abs(a - b) < tolerance,
    `${a} should be within ${tolerance} of ${b}`,
  );
test("rotation is optional and bounded; geometry rotates in actual landscape/portrait pixels", () => {
  assert.equal(layerSchema.parse(base).rotation, undefined);
  for (const rotation of [-180, -45.5, 0, 90, 180])
    assert.equal(layerSchema.parse({ ...base, rotation }).rotation, rotation);
  for (const rotation of [-181, 181, NaN, Infinity])
    assert.equal(layerSchema.safeParse({ ...base, rotation }).success, false);
  for (const [size, expected] of [
    [
      formats.landscape,
      [
        [584, 160],
        [584, 416],
        [440, 416],
        [440, 160],
      ],
    ],
    [
      formats.portrait,
      [
        [416, 440],
        [416, 584],
        [160, 584],
        [160, 440],
      ],
    ],
  ] as const) {
    const corners = layerCorners({ ...base, rotation: 90 }, size);
    for (let i = 0; i < 4; i++) {
      near(corners[i].x * size.width, expected[i][0]);
      near(corners[i].y * size.height, expected[i][1]);
    }
  }
});
test("rotated resizing follows the pointer in local axes, fixes the opposite corner and respects limits/locks", () => {
  for (const size of Object.values(formats))
    for (const rotation of [-135, -90, -45, 45, 90, 135, 180]) {
      const layer = { ...base, rotation };
      const before = layerCorners(layer, size);
      const after = placeLayer(layer, 0.008, 0.012, true, false, size);
      const corners = layerCorners(after, size);
      near(corners[0].x * size.width, before[0].x * size.width, 0.25);
      near(corners[0].y * size.height, before[0].y * size.height, 0.25);
      near(corners[2].x * size.width, (before[2].x + 0.008) * size.width, 0.25);
      near(
        corners[2].y * size.height,
        (before[2].y + 0.012) * size.height,
        0.25,
      );
      assert(layerSchema.safeParse(after).success);
      for (const [dx, dy] of [
        [1000, -1000],
        [-1000, 1000],
        [1000, 1000],
      ]) {
        const constrained = placeLayer(layer, dx, dy, true, false, size);
        assert(layerSchema.safeParse(constrained).success);
        assert(constrained.x + constrained.width <= 1 + 1e-9);
        assert(constrained.y + constrained.height <= 1 + 1e-9);
      }
      const locked = { ...layer, locked: true };
      assert.equal(placeLayer(locked, 0.1, 0.1, true, false, size), locked);
    }
});
test("QC checks rotated text polygons and warns about intentional clipping without silently changing the angle", () => {
  const t = blankTimeline({ ...brief, format: "square" });
  const a = {
    ...base,
    id: "a",
    kind: "text" as const,
    text: "A",
    x: 0.2,
    y: 0.4,
    width: 0.5,
    height: 0.05,
    rotation: 90,
  };
  const b = { ...a, id: "b", text: "B", rotation: 0, y: 0.46 };
  t.scenes[0].layers = [a, b];
  assert(inspectTimeline(t).some((i) => i.code === "overlap"));
  b.y = 0.42;
  b.width = 0.2;
  b.height = 0.02;
  assert(!inspectTimeline(t).some((i) => i.code === "overlap"));
  assert.equal(
    polygonsOverlap(
      layerCorners(base, formats.square),
      layerCorners({ ...base, x: base.x + base.width }, formats.square),
    ),
    false,
  );
  t.scenes[0].layers = [
    { ...base, x: 0, y: 0, width: 0.8, height: 0.1, rotation: 45 },
  ];
  const warning = inspectTimeline(t).find((i) => i.code === "rotation-bounds");
  assert.equal(warning?.severity, "warning");
  assert.deepEqual(repairBounds(t).timeline, t);
});
test("rotation survives split, schema parsing and portable saved-history remapping", async () => {
  const t = blankTimeline(brief);
  t.scenes[0].layers = [{ ...base, rotation: -77 }];
  const split = splitScene(timelineSchema.parse(t), 0, 75);
  assert(split.scenes.every((s) => s.layers[0].rotation === -77));
  const p: Project = {
    id: crypto.randomUUID(),
    name: "Rotated portable story",
    brief,
    timeline: split,
    assets: [],
    messages: [],
    createdAt: new Date().toISOString(),
    revisions: [
      {
        id: crypto.randomUUID(),
        createdAt: new Date().toISOString(),
        source: "Rotation",
        timeline: split,
      },
    ],
  };
  const archive = await exportArchive(p);
  const envelope = JSON.parse(strFromU8(unzipSync(archive)["project.json"]));
  assert.equal(envelope.version, 2);
  assert.deepEqual(envelope.requiredFeatures, ["layer-rotation-v1"]);
  const restored = await importArchive(archive);
  assert(restored.timeline!.scenes.every((s) => s.layers[0].rotation === -77));
  assert.equal(
    restored.revisions[0].timeline.scenes[1].layers[0].rotation,
    -77,
  );
  p.timeline = blankTimeline(brief);
  assert.equal(
    JSON.parse(strFromU8(unzipSync(await exportArchive(p))["project.json"]))
      .version,
    2,
    "rotated historical versions also require the new capability",
  );
  envelope.requiredFeatures = ["unknown-rendering-feature"];
  await assert.rejects(() =>
    importArchive(
      zipSync({ "project.json": strToU8(JSON.stringify(envelope)) }),
    ),
  );
});
