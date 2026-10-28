import { test } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { zipSync, strToU8 } from "fflate";
import { exportArchive, importArchive } from "../src/lib/archive";
import { storeImage } from "../src/lib/assets";
import { mockPlan } from "../src/lib/provider";
import type { Project } from "../src/lib/schema";
test("editable archive round trip preserves content/history and remaps local assets", async () => {
  const asset = await storeImage(
    await sharp({
      create: { width: 10, height: 10, channels: 3, background: "#234567" },
    })
      .png()
      .toBuffer(),
    "test.png",
    "Test-owned",
  );
  const brief = {
    prompt: "Portable story",
    duration: 5,
    format: "landscape" as const,
  };
  const timeline = mockPlan(brief);
  timeline.scenes[0].layers[2].kind = "image";
  timeline.scenes[0].layers[2].assetId = asset.id;
  const p: Project = {
    id: "original",
    name: "Test",
    brief,
    timeline,
    assets: [asset],
    messages: [{ role: "user", content: brief.prompt }],
    createdAt: new Date().toISOString(),
    revisions: [
      {
        id: "revision",
        timeline,
        source: "Test",
        createdAt: new Date().toISOString(),
      },
    ],
  };
  const restored = await importArchive(await exportArchive(p));
  assert.notEqual(restored.id, p.id);
  assert.notEqual(restored.assets![0].id, asset.id);
  assert.equal(
    restored.timeline!.scenes[0].layers[2].assetId,
    restored.assets![0].id,
  );
  assert.deepEqual(restored.messages, p.messages);
  assert.equal(
    restored.revisions[0].timeline.scenes[0].layers[2].assetId,
    restored.assets![0].id,
  );
  assert.equal(p.timeline!.scenes[0].layers[2].assetId, asset.id);
});
test("portable import rejects traversal, absent manifests and malformed projects", async () => {
  await assert.rejects(
    () => importArchive(zipSync({ "../escape": strToU8("bad") })),
    /invalid paths/,
  );
  await assert.rejects(() =>
    importArchive(zipSync({ "assets/123": strToU8("bad") })),
  );
  await assert.rejects(() =>
    importArchive(zipSync({ "project.json": strToU8("{}") })),
  );
});
