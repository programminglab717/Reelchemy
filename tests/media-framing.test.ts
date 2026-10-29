import { test } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { unlink } from "node:fs/promises";
import path from "node:path";
import { mediaStyle } from "../src/lib/media-style";
import { blankTimeline } from "../src/lib/editor";
import { layerSchema, timelineSchema } from "../src/lib/schema";
import { storeImage, assetDir } from "../src/lib/assets";
import { splitScene } from "../src/lib/timeline-edit";
import { exportArchive, importArchive } from "../src/lib/archive";
import { localSceneTimeline, sceneCacheKey } from "../src/lib/render-cache";

test("bounded source framing preserves default fit and selects the correct image/video style", () => {
  const layer = blankTimeline({
    prompt: "Framing",
    duration: 5,
    format: "landscape",
  }).scenes[0].layers[0];
  assert.equal(mediaStyle(layer).objectFit, "contain");
  assert.equal(mediaStyle(layer).objectPosition, "50% 50%");
  assert.equal(
    mediaStyle({ ...layer, imageFit: "cover", mediaPosition: { x: 0, y: 1 } })
      .objectPosition,
    "0% 100%",
  );
  assert.equal(
    mediaStyle({
      ...layer,
      kind: "video",
      video: {
        fit: "cover",
        startFrame: 0,
        offsetFrames: 0,
        durationFrames: 30,
        audio: false,
        volume: 1,
      },
    }).objectFit,
    "cover",
  );
  for (const mediaPosition of [
    { x: -0.1, y: 0.5 },
    { x: 1.1, y: 0.5 },
    { x: NaN, y: 0 },
    { x: "url(remote)", y: 0 },
  ])
    assert.equal(
      layerSchema.safeParse({ ...layer, mediaPosition }).success,
      false,
    );
});
test("source framing survives split and portable media remapping while invalidating only changed scene clips", async () => {
  const asset = await storeImage(
    await sharp({
      create: { width: 20, height: 10, channels: 3, background: "#123456" },
    })
      .png()
      .toBuffer(),
    "framing.png",
    "Owned synthetic test",
  );
  let importedId: string | undefined;
  try {
    const brief = {
      prompt: "Framing archive",
      duration: 5,
      format: "square" as const,
    };
    const timeline = blankTimeline(brief);
    timeline.scenes[0].layers[0] = {
      ...timeline.scenes[0].layers[0],
      kind: "image",
      assetId: asset.id,
      imageFit: "cover",
      mediaPosition: { x: 0, y: 1 },
    };
    const split = splitScene(timelineSchema.parse(timeline), 0, 60);
    assert.deepEqual(split.scenes[1].layers[0].mediaPosition, { x: 0, y: 1 });
    const old = split.scenes.map((_, i) =>
      sceneCacheKey(localSceneTimeline(split, i), {}, "renderer"),
    );
    split.scenes[0].layers[0].mediaPosition!.x = 1;
    assert.notEqual(
      sceneCacheKey(localSceneTimeline(split, 0), {}, "renderer"),
      old[0],
    );
    assert.equal(
      sceneCacheKey(localSceneTimeline(split, 1), {}, "renderer"),
      old[1],
    );
    const p = {
      id: crypto.randomUUID(),
      name: "Framing",
      brief,
      timeline: split,
      assets: [asset],
      revisions: [],
      messages: [],
      createdAt: new Date().toISOString(),
    };
    const imported = await importArchive(await exportArchive(p));
    importedId = imported.assets![0].id;
    assert.notEqual(importedId, asset.id);
    assert.equal(imported.timeline!.scenes[0].layers[0].imageFit, "cover");
    assert.deepEqual(imported.timeline!.scenes[0].layers[0].mediaPosition, {
      x: 1,
      y: 1,
    });
  } finally {
    await unlink(path.join(assetDir, asset.id));
    if (importedId) await unlink(path.join(assetDir, importedId));
  }
});
