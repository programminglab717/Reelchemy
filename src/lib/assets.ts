import { mkdir, readFile, writeFile, stat } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import type { Asset, Timeline } from "./schema";
import { validAssetId } from "./project-assets";
export const assetDir = path.resolve(
  process.env.REELCHEMY_DATA_DIR || ".data",
  "assets",
);
export async function storeImage(
  bytes: Buffer,
  name: string,
  license: string,
  maxBytes = 10 * 1024 * 1024,
): Promise<Asset> {
  if (bytes.length > maxBytes)
    throw new Error("Images must be 10 MB or smaller.");
  const image = sharp(bytes, { limitInputPixels: 16000000 });
  const meta = await image.metadata();
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
  const id = randomUUID();
  await mkdir(assetDir, { recursive: true });
  await writeFile(path.join(assetDir, id), clean, { flag: "wx" });
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
export async function resolveAssetSources(t: Timeline) {
  const sources: Record<string, string> = {};
  for (const s of t.scenes)
    for (const l of s.layers) {
      if (!l.assetId) continue;
      if (sources[l.assetId]) continue;
      if (!validAssetId(l.assetId))
        throw new Error(`Missing or invalid asset: ${l.assetId}`);
      try {
        if (l.kind === "video") {
          await stat(path.join(assetDir, l.assetId));
          sources[l.assetId] = `local-video:${l.assetId}`;
          continue;
        }
        sources[l.assetId] =
          `data:image/png;base64,${(await readFile(path.join(assetDir, l.assetId))).toString("base64")}`;
      } catch {
        throw new Error(`Missing asset: ${l.assetId}`);
      }
    }
  for (const track of t.audioTracks || []) {
    if (!validAssetId(track.assetId)) throw new Error("Invalid audio asset.");
    sources[track.assetId] =
      `data:audio/wav;base64,${(await readFile(path.join(assetDir, track.assetId))).toString("base64")}`;
  }
  return sources;
}

export { validateProjectAssets, validAssetId } from "./project-assets";
