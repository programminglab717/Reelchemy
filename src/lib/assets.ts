import path from "node:path";
import sharp from "sharp";
import type { Asset } from "./schema";
import {
  assertNormalizationActive,
  normalizationId,
  writeNormalizedMedia,
  type MediaNormalizationOptions,
} from "./media-normalization";
export const assetDir = path.resolve(
  process.env.REELCHEMY_DATA_DIR || ".data",
  "assets",
);
export async function storeImage(
  bytes: Buffer,
  name: string,
  license: string,
  maxBytes = 10 * 1024 * 1024,
  options: MediaNormalizationOptions = {},
): Promise<Asset> {
  const id = normalizationId(options);
  if (bytes.length > maxBytes)
    throw new Error("Images must be 10 MB or smaller.");
  const image = sharp(bytes, { limitInputPixels: 16000000 });
  const meta = await image.metadata();
  assertNormalizationActive(options);
  if (!["png", "jpeg"].includes(meta.format || ""))
    throw new Error("Only PNG and JPEG images are supported.");
  // Bake EXIF orientation into the pixels before stripping private metadata.
  // Otherwise phone photos lose their intended rotation/mirroring on export.
  const { data: clean, info } = await image
    .autoOrient()
    .png()
    .toBuffer({ resolveWithObject: true });
  if (clean.length > 20 * 1024 * 1024)
    throw new Error("Decoded image is too large.");
  writeNormalizedMedia(id, clean, options);
  return {
    id,
    name:
      path
        .basename(name)
        .replace(/[^a-zA-Z0-9._ -]/g, "_")
        .slice(0, 100) || "Image",
    source: "User upload",
    license,
    mime: "image/png",
    bytes: clean.length,
    width: info.width,
    height: info.height,
    createdAt: new Date().toISOString(),
  };
}
export { validateProjectAssets, validAssetId } from "./project-assets";
