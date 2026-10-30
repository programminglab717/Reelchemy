import { zipSync, unzipSync, strToU8, strFromU8 } from "fflate";
import { readFile, stat, unlink } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  assetDir,
  validAssetId,
  storeImage,
  validateProjectAssets,
} from "./assets";
import { storeAudio } from "./audio";
import { storeVideo } from "./video";
import {
  timelineSchema,
  type Project,
  type Timeline,
  type Asset,
} from "./schema";
const MAX_TOTAL = 150 * 1024 * 1024;
const portableProject = z.object({
  id: z.string().max(80),
  name: z.string().min(1).max(100),
  createdAt: z.string().datetime(),
  brief: z.object({
    prompt: z.string().min(1).max(1200),
    duration: z.number().int().min(5).max(60),
    format: z.enum(["landscape", "portrait", "square"]),
  }),
  assets: z
    .array(
      z.object({
        id: z.string().uuid(),
        name: z.string().max(100),
        source: z.string().max(500),
        license: z.string().min(1).max(500),
        mime: z.enum(["image/png", "audio/wav", "video/mp4"]),
        bytes: z
          .number()
          .int()
          .min(1)
          .max(25 * 1024 * 1024)
          .optional(),
        width: z.number().int().min(1).max(4096).optional(),
        height: z.number().int().min(1).max(4096).optional(),
        hasAudio: z.boolean().optional(),
        durationFrames: z.number().int().min(0).max(3600).optional(),
        createdAt: z.string().datetime(),
      }),
    )
    .max(30)
    .optional(),
  timeline: timelineSchema.nullable(),
  revisions: z
    .array(
      z.object({
        id: z.string().max(80),
        createdAt: z.string().datetime(),
        source: z.string().max(500),
        timeline: timelineSchema,
      }),
    )
    .max(500),
  messages: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().max(6000),
      }),
    )
    .max(1000),
});
export async function exportArchive(project: Project) {
  const files: Record<string, Uint8Array> = {};
  const manifest = strToU8(
    JSON.stringify({ format: "reelchemy", version: 1, project }),
  );
  if (manifest.length > 10 * 1024 * 1024)
    throw new Error("Project history is too large for a portable archive.");
  files["project.json"] = manifest;
  let total = manifest.length;
  for (const asset of project.assets || []) {
    if (!validAssetId(asset.id)) throw new Error("Invalid project asset.");
    const file = path.join(assetDir, asset.id);
    total += (await stat(file)).size;
    if (total > MAX_TOTAL)
      throw new Error("Project exceeds the 150 MB portable export limit.");
    files[`assets/${asset.id}`] = await readFile(file);
  }
  const zip = zipSync(files, { level: 6 });
  if (zip.length > 50 * 1024 * 1024)
    throw new Error("Project exceeds the 50 MB portable archive limit.");
  return zip;
}
export async function importArchive(bytes: Uint8Array): Promise<Project> {
  if (bytes.length > 50 * 1024 * 1024)
    throw new Error("Archives must be 50 MB or smaller.");
  let total = 0;
  const names = new Set<string>();
  const files = unzipSync(bytes, {
    filter: (file) => {
      if (names.has(file.name)) throw new Error("Duplicate archive entries.");
      names.add(file.name);
      total += file.originalSize;
      if (
        file.originalSize > 25 * 1024 * 1024 ||
        total > MAX_TOTAL ||
        names.size > 31 ||
        !(
          file.name === "project.json" ||
          /^assets\/[a-f0-9-]{36}$/.test(file.name)
        )
      )
        throw new Error(
          "Archive contains invalid paths or exceeds extraction limits.",
        );
      return true;
    },
  });
  if (!files["project.json"] || files["project.json"].length > 10 * 1024 * 1024)
    throw new Error("Missing or oversized project manifest.");
  const envelope = z
    .object({
      format: z.literal("reelchemy"),
      version: z.literal(1),
      project: portableProject,
    })
    .parse(JSON.parse(strFromU8(files["project.json"])));
  const input = envelope.project;
  if (
    new Set(input.assets?.map((a) => a.id)).size !== (input.assets || []).length
  )
    throw new Error("Duplicate asset IDs.");
  const used = new Set([
    "project.json",
    ...(input.assets || []).map((a) => `assets/${a.id}`),
  ]);
  if (Object.keys(files).some((k) => !used.has(k)))
    throw new Error("Unexpected archive files.");
  const assets: Asset[] = [];
  const mapping = new Map<string, string>();
  try {
    for (const a of input.assets || []) {
      const source = files[`assets/${a.id}`];
      if (!source) throw new Error(`Missing archived asset: ${a.name}`);
      const asset =
        a.mime === "video/mp4"
          ? await storeVideo(Buffer.from(source), a.name, a.license)
          : await (a.mime === "audio/wav" ? storeAudio : storeImage)(
              Buffer.from(source),
              a.name,
              a.license,
              25 * 1024 * 1024,
            );
      assets.push(asset);
      mapping.set(a.id, asset.id);
    }
    const remap = (t: Timeline): Timeline => {
      const result = structuredClone(t);
      for (const s of result.scenes)
        for (const layer of s.layers)
          if (layer.assetId) {
            const id = mapping.get(layer.assetId);
            if (
              !id ||
              assets.find((a) => a.id === id)?.mime !==
                (layer.kind === "video" ? "video/mp4" : "image/png")
            )
              throw new Error("Invalid image reference in archived timeline.");
            layer.assetId = id;
          }
      for (const track of result.audioTracks || []) {
        const id = mapping.get(track.assetId),
          asset = assets.find((a) => a.id === id);
        if (
          !id ||
          asset?.mime !== "audio/wav" ||
          track.offsetFrames + track.durationFrames >
            (asset.durationFrames || 0)
        )
          throw new Error("Invalid audio reference in archived timeline.");
        track.assetId = id;
      }
      const timeline = timelineSchema.parse(result);
      validateProjectAssets({ assets } as Project, timeline);
      return timeline;
    };
    return {
      ...input,
      id: randomUUID(),
      name: `${input.name.slice(0, 88)} (imported)`,
      assets,
      timeline: input.timeline ? remap(input.timeline) : null,
      revisions: input.revisions.map((r) => ({
        ...r,
        timeline: remap(r.timeline),
      })),
    };
  } catch (e) {
    await Promise.all(
      assets.map((a) => unlink(path.join(assetDir, a.id)).catch(() => {})),
    );
    throw e;
  }
}
