import path from "node:path";
import sharp from "sharp";
import type { Asset } from "./schema";
import {
  MAX_MEDIA_UPLOAD_BYTES,
  MAX_STORED_MEDIA_BYTES,
  mediaUploadLimitText,
} from "./timeline-limits";
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
  maxBytes: number = MAX_MEDIA_UPLOAD_BYTES.image,
  options: MediaNormalizationOptions = {},
): Promise<Asset> {
  const id = normalizationId(options);
  if (bytes.length > Math.min(maxBytes, MAX_MEDIA_UPLOAD_BYTES.image))
    throw new Error(
      `Images must be ${mediaUploadLimitText("image")} or smaller.`,
    );
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
  if (clean.length > MAX_STORED_MEDIA_BYTES.image)
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
