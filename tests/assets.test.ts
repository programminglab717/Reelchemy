import { test } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import {
  storeImage,
  resolveAssetSources,
  validAssetId,
} from "../src/lib/assets";
import { mockPlan } from "../src/lib/provider";
test("image ingestion verifies bytes, sanitizes names and renderer resolves only local data", async () => {
  await assert.rejects(() =>
    storeImage(Buffer.from("<svg/>"), "bad.svg", "Test"),
  );
  const data = await sharp({
    create: { width: 20, height: 20, channels: 3, background: "#445566" },
  })
    .png()
    .toBuffer();
  const asset = await storeImage(data, "../../image.png", "Owned test image");
  assert.equal(asset.name, "image.png");
  assert(validAssetId(asset.id));
  assert(!validAssetId("../secrets"));
  const t = mockPlan({ prompt: "Test", duration: 5, format: "square" });
  t.scenes[0].layers[2].assetId = asset.id;
  t.scenes[0].layers[2].kind = "image";
  const sources = await resolveAssetSources(t);
  assert(sources[asset.id].startsWith("data:image/png;base64,"));
  t.scenes[0].layers[2].assetId = "https://example.com/image.png";
  await assert.rejects(() => resolveAssetSources(t));
});
