import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import sharp from "sharp";
const dir = await mkdtemp(path.join(tmpdir(), "reelchemy-images-"));
process.env.REELCHEMY_DATA_DIR = dir;
after(() => rm(dir, { recursive: true, force: true }));
const { storeImage, resolveAssetSources, validAssetId, assetDir } =
  await import("../src/lib/assets");
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
test("all eight EXIF orientations become correct pixels and dimensions before private metadata is stripped", async (t) => {
  const colors = [
    [240, 20, 20],
    [20, 240, 20],
    [20, 20, 240],
    [240, 240, 20],
  ];
  const pixels = Buffer.alloc(80 * 40 * 3);
  for (let y = 0; y < 40; y++)
    for (let x = 0; x < 80; x++)
      pixels.set(
        colors[(y >= 20 ? 2 : 0) + (x >= 40 ? 1 : 0)],
        (y * 80 + x) * 3,
      );
  const expected = [
    [0, 1, 2, 3],
    [1, 0, 3, 2],
    [3, 2, 1, 0],
    [2, 3, 0, 1],
    [0, 2, 1, 3],
    [2, 0, 3, 1],
    [3, 1, 2, 0],
    [1, 3, 0, 2],
  ];
  for (let orientation = 1; orientation <= 8; orientation++)
    await t.test(`EXIF orientation ${orientation}`, async () => {
      const source = await sharp(pixels, {
        raw: { width: 80, height: 40, channels: 3 },
      })
        .withMetadata({ orientation })
        .withExifMerge({ IFD0: { Artist: "Private synthetic owner" } })
        .jpeg({ quality: 100, chromaSubsampling: "4:4:4" })
        .toBuffer();
      assert.equal((await sharp(source).metadata()).orientation, orientation);
      const asset = await storeImage(source, "phone.jpg", "Owned fixture");
      const normalized = await readFile(path.join(assetDir, asset.id));
      const meta = await sharp(normalized).metadata();
      assert.equal(meta.orientation, undefined);
      assert.equal(meta.exif, undefined);
      assert.equal(meta.format, "png");
      assert.equal(asset.bytes, normalized.length);
      const width = orientation < 5 ? 80 : 40,
        height = orientation < 5 ? 40 : 80;
      assert.equal(asset.width, width);
      assert.equal(asset.height, height);
      assert.equal(meta.width, width);
      assert.equal(meta.height, height);
      const raw = await sharp(normalized).removeAlpha().raw().toBuffer();
      for (let corner = 0; corner < 4; corner++) {
        const x = Math.floor(width * (corner % 2 ? 0.75 : 0.25));
        const y = Math.floor(height * (corner < 2 ? 0.25 : 0.75));
        const color = colors[expected[orientation - 1][corner]];
        for (let c = 0; c < 3; c++)
          assert(Math.abs(raw[(y * width + x) * 3 + c] - color[c]) < 12);
      }
    });
});
