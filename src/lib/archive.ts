import { zipSync, unzipSync, strToU8, strFromU8 } from "fflate";
import {
  constants,
  openSync,
  closeSync,
  fstatSync,
  readSync,
  unlinkSync,
} from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { assertNormalizationActive } from "./media-normalization";
import { withPrivateDirectory } from "./private-directory";
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
const MAX_MANIFEST = 10 * 1024 * 1024;
const MAX_ASSET = 25 * 1024 * 1024;
const MAX_REVISIONS = 10000;
const MAX_MESSAGES = 10000;
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
        // Image admission bounds decoded pixels, not each edge. Dimensions
        // are re-measured by normalization rather than trusted on import.
        width: z.number().int().min(1).max(16000000).optional(),
        height: z.number().int().min(1).max(16000000).optional(),
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
    .max(MAX_REVISIONS),
  messages: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().max(6000),
      }),
    )
    .max(MAX_MESSAGES),
});
const legacyProject = portableProject.extend({
  revisions: portableProject.shape.revisions.max(500),
  messages: portableProject.shape.messages.max(1000),
});
const envelopeSchema = z.discriminatedUnion("version", [
  z.object({
    format: z.literal("reelchemy"),
    version: z.literal(1),
    project: legacyProject,
  }),
  z.object({
    format: z.literal("reelchemy"),
    version: z.literal(2),
    requiredFeatures: z.tuple([z.literal("layer-rotation-v1")]),
    project: legacyProject,
  }),
  z.object({
    format: z.literal("reelchemy"),
    version: z.literal(3),
    requiredFeatures: z
      .array(z.enum(["large-history-v1", "layer-rotation-v1"]))
      .min(1)
      .max(2)
      .refine(
        (features) =>
          features.includes("large-history-v1") &&
          new Set(features).size === features.length,
      ),
    project: portableProject,
  }),
]);
// Reject counts before recursive schema validation can allocate errors for
// every member of a hostile collection. Manifest bytes have a separate cap.
function checkCollections(input: unknown, legacy: boolean) {
  if (!input || typeof input !== "object")
    throw new Error("Invalid portable project.");
  const value = input as Record<string, unknown>;
  for (const [key, limit] of [
    ["assets", 30],
    ["revisions", legacy ? 500 : MAX_REVISIONS],
    ["messages", legacy ? 1000 : MAX_MESSAGES],
  ] as const)
    if (Array.isArray(value[key]) && value[key].length > limit)
      throw new Error(`Portable projects support up to ${limit} ${key}.`);
}
function withAssetDirectory<T>(operation: (anchor: string) => T) {
  return withPrivateDirectory(
    path.dirname(assetDir),
    path.basename(assetDir),
    operation,
  );
}
function readArchivedAsset(anchor: string, id: string, remaining: number) {
  let fd: number | undefined;
  try {
    fd = openSync(
      path.join(anchor, id),
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    const before = fstatSync(fd, { bigint: true });
    if (!before.isFile() || before.size < 1 || before.size > MAX_ASSET)
      throw new Error(
        "Portable assets must be regular files of 25 MB or smaller.",
      );
    if (before.size > remaining)
      throw new Error("Project exceeds the 150 MB portable export limit.");
    const bytes = Buffer.alloc(Number(before.size));
    let offset = 0;
    while (offset < bytes.length) {
      const count = readSync(fd, bytes, offset, bytes.length - offset, offset);
      if (!count)
        throw new Error("An archived asset changed while being read.");
      offset += count;
    }
    const after = fstatSync(fd, { bigint: true });
    if (
      before.size !== after.size ||
      before.mtimeNs !== after.mtimeNs ||
      before.ctimeNs !== after.ctimeNs
    )
      throw new Error("An archived asset changed while being read.");
    return bytes;
  } catch {
    // File-system errors include private paths; none may enter an HTTP response.
    throw new Error(
      "An archived asset is missing, unsafe, changed, or exceeds portable limits.",
    );
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}
export async function exportArchive(project: Project) {
  checkCollections(project, false);
  if (Buffer.byteLength(JSON.stringify(project)) > MAX_MANIFEST)
    throw new Error("Project history is too large for a portable archive.");
  const input = portableProject.parse(project);
  if (
    new Set(input.assets?.map((asset) => asset.id)).size !==
    (input.assets || []).length
  )
    throw new Error("Duplicate asset IDs.");
  for (const timeline of [
    input.timeline,
    ...input.revisions.map((revision) => revision.timeline),
  ])
    if (timeline) validateProjectAssets(input, timeline);
  const largeHistory =
    input.revisions.length > 500 || input.messages.length > 1000;
  const files: Record<string, Uint8Array> = {};
  const needsRotation = [
    input.timeline,
    ...input.revisions.map((r) => r.timeline),
  ].some((t) => t?.scenes.some((s) => s.layers.some((l) => !!l.rotation)));
  const manifest = strToU8(
    JSON.stringify({
      format: "reelchemy",
      version: largeHistory ? 3 : needsRotation ? 2 : 1,
      ...(largeHistory || needsRotation
        ? {
            requiredFeatures: [
              ...(largeHistory ? ["large-history-v1"] : []),
              ...(needsRotation ? ["layer-rotation-v1"] : []),
            ],
          }
        : {}),
      project: input,
    }),
  );
  if (manifest.length > MAX_MANIFEST)
    throw new Error("Project history is too large for a portable archive.");
  files["project.json"] = manifest;
  let total = manifest.length;
  if (input.assets?.length) {
    try {
      withAssetDirectory((anchor) => {
        for (const asset of input.assets || []) {
          if (!validAssetId(asset.id))
            throw new Error("Invalid project asset.");
          const bytes = readArchivedAsset(anchor, asset.id, MAX_TOTAL - total);
          total += bytes.length;
          files[`assets/${asset.id}`] = bytes;
        }
      });
    } catch {
      throw new Error(
        "An archived asset is missing, unsafe, changed, or exceeds portable limits.",
      );
    }
  }
  const zip = zipSync(files, { level: 6 });
  if (zip.length > 50 * 1024 * 1024)
    throw new Error("Project exceeds the 50 MB portable archive limit.");
  return zip;
}
export async function importArchive(
  bytes: Uint8Array,
  options: {
    cancelled?: () => boolean;
    registerOutputs?: (ids: string[]) => void;
  } = {},
): Promise<Project> {
  assertNormalizationActive(options);
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
        file.originalSize >
          (file.name === "project.json" ? MAX_MANIFEST : MAX_ASSET) ||
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
  if (!files["project.json"] || files["project.json"].length > MAX_MANIFEST)
    throw new Error("Missing or oversized project manifest.");
  const raw: unknown = JSON.parse(strFromU8(files["project.json"]));
  if (!raw || typeof raw !== "object")
    throw new Error("Invalid portable archive.");
  const candidate = raw as Record<string, unknown>;
  checkCollections(candidate.project, candidate.version !== 3);
  const envelope = envelopeSchema.parse(raw);
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
  // Persist every possible output before the first codec runs. A worker killed
  // after writing a file can then clean it without relying on in-memory state.
  const outputIds = (input.assets || []).map(() => randomUUID());
  options.registerOutputs?.(outputIds);
  try {
    for (const [index, a] of (input.assets || []).entries()) {
      assertNormalizationActive(options);
      const normalization = {
        id: outputIds[index],
        cancelled: options.cancelled,
      };
      const source = files[`assets/${a.id}`];
      if (!source) throw new Error(`Missing archived asset: ${a.name}`);
      const asset =
        a.mime === "video/mp4"
          ? await storeVideo(
              Buffer.from(source),
              a.name,
              a.license,
              normalization,
            )
          : await (a.mime === "audio/wav" ? storeAudio : storeImage)(
              Buffer.from(source),
              a.name,
              a.license,
              25 * 1024 * 1024,
              normalization,
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
    assertNormalizationActive(options);
    const revisionCounts = new Map<string, number>();
    for (const revision of input.revisions)
      revisionCounts.set(
        revision.id,
        (revisionCounts.get(revision.id) || 0) + 1,
      );
    return {
      ...input,
      id: randomUUID(),
      name: `${input.name.slice(0, 88)} (imported)`,
      assets,
      timeline: input.timeline ? remap(input.timeline) : null,
      revisions: input.revisions.map((r) => ({
        ...r,
        // Preserve usable legacy identities; repair ambiguous or unreadable IDs
        // only in the imported copy so every retained edit can be selected.
        id:
          !r.id ||
          /[\u0000-\u001f\u007f]/.test(r.id) ||
          revisionCounts.get(r.id)! > 1
            ? randomUUID()
            : r.id,
        timeline: remap(r.timeline),
      })),
    };
  } catch (e) {
    try {
      withAssetDirectory((anchor) => {
        for (const asset of assets) {
          try {
            unlinkSync(path.join(anchor, asset.id));
          } catch {
            /* Durable worker cleanup retries registered outputs. */
          }
        }
      });
    } catch {
      /* An unsafe replaced directory must never be followed for cleanup. */
    }
    throw e;
  }
}
