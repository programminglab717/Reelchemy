import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import type { Asset, Timeline, Project } from "./schema";
export const assetDir = path.resolve(
  process.env.REELCHEMY_DATA_DIR || ".data",
  "assets",
);
export function validAssetId(id: string) {
  return /^[a-f0-9-]{36}$/.test(id);
}
export async function storeImage(
  bytes: Buffer,
  name: string,
  license: string,
): Promise<Asset> {
  if (bytes.length > 10 * 1024 * 1024)
    throw new Error("Images must be 10 MB or smaller.");
  const image = sharp(bytes, { limitInputPixels: 16000000 });
  const meta = await image.metadata();
  if (!["png", "jpeg"].includes(meta.format || ""))
    throw new Error("Only PNG and JPEG images are supported.");
  const clean = await image.png().toBuffer();
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
    createdAt: new Date().toISOString(),
  };
}
export async function resolveAssetSources(t: Timeline) {
  const sources: Record<string, string> = {};
  for (const s of t.scenes)
    for (const l of s.layers) {
      if (!l.assetId) continue;
      if (!validAssetId(l.assetId))
        throw new Error(`Missing or invalid asset: ${l.assetId}`);
      try {
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

export function validateProjectAssets(project: Project, t: Timeline) {
  for (const scene of t.scenes)
    for (const layer of scene.layers)
      if (
        layer.assetId &&
        !project.assets?.some(
          (a) => a.id === layer.assetId && a.mime === "image/png",
        )
      )
        throw new Error("Image references must belong to this project.");
  for (const track of t.audioTracks || []) {
    const asset = project.assets?.find((a) => a.id === track.assetId);
    if (asset?.mime !== "audio/wav")
      throw new Error(
        "Audio tracks must reference audio uploaded to this project.",
      );
    if (track.offsetFrames + track.durationFrames > (asset.durationFrames || 0))
      throw new Error("Audio trim exceeds the source duration.");
  }
}
