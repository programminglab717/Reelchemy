import path from "node:path";
import type { Asset, FontMime } from "./schema";
import { MAX_MEDIA_UPLOAD_BYTES } from "./timeline-limits";
import {
  assertNormalizationActive,
  normalizationId,
  writeNormalizedMedia,
  type MediaNormalizationOptions,
} from "./media-normalization";

// Brand fonts are kept byte-for-byte: no font code runs on the server. They
// are only parsed by Chromium, whose OpenType sanitizer rejects malformed
// tables. This structural check refuses non-fonts, collections and
// truncated/inconsistent containers before they are stored.
const MAX_TABLES = 64;
const tag = (bytes: Buffer, offset: number) =>
  bytes.toString("latin1", offset, offset + 4);

export function sniffFontMime(bytes: Buffer): FontMime | null {
  if (bytes.length < 12) return null;
  const signature = tag(bytes, 0);
  if (signature === "\0\x01\0\0" || signature === "true") return "font/ttf";
  if (signature === "OTTO") return "font/otf";
  if (signature === "wOFF") return "font/woff";
  if (signature === "wOF2") return "font/woff2";
  return null;
}

function sfnt(bytes: Buffer) {
  const tables = bytes.readUInt16BE(4);
  if (tables < 1 || tables > MAX_TABLES || 12 + tables * 16 > bytes.length)
    return false;
  const tags = new Set<string>();
  for (let i = 0; i < tables; i++) {
    const record = 12 + i * 16,
      offset = bytes.readUInt32BE(record + 8),
      length = bytes.readUInt32BE(record + 12);
    if (offset < 12 + tables * 16 || offset + length > bytes.length)
      return false;
    tags.add(tag(bytes, record));
  }
  return (
    ["cmap", "head", "name"].every((t) => tags.has(t)) &&
    (tags.has("glyf") || tags.has("CFF ") || tags.has("CFF2"))
  );
}

function woff(bytes: Buffer) {
  if (bytes.length < 44 || bytes.readUInt32BE(8) !== bytes.length) return false;
  const flavor = tag(bytes, 4),
    tables = bytes.readUInt16BE(12);
  if (
    !["\0\x01\0\0", "true", "OTTO"].includes(flavor) ||
    tables < 1 ||
    tables > MAX_TABLES ||
    bytes.readUInt16BE(14) !== 0 ||
    44 + tables * 20 > bytes.length
  )
    return false;
  for (let i = 0; i < tables; i++) {
    const record = 44 + i * 20,
      offset = bytes.readUInt32BE(record + 4),
      compressed = bytes.readUInt32BE(record + 8),
      original = bytes.readUInt32BE(record + 12);
    if (
      offset < 44 + tables * 20 ||
      offset + compressed > bytes.length ||
      compressed > original ||
      original > 64 * 1024 * 1024
    )
      return false;
  }
  return true;
}

function woff2(bytes: Buffer) {
  if (bytes.length < 48 || bytes.readUInt32BE(8) !== bytes.length) return false;
  const flavor = tag(bytes, 4),
    tables = bytes.readUInt16BE(12);
  return (
    ["\0\x01\0\0", "true", "OTTO"].includes(flavor) &&
    tables >= 1 &&
    tables <= MAX_TABLES &&
    bytes.readUInt16BE(14) === 0 &&
    // totalSfntSize (decompressed) must stay reasonable.
    bytes.readUInt32BE(16) <= 64 * 1024 * 1024
  );
}

export function validateFont(bytes: Buffer): FontMime {
  const mime = sniffFontMime(bytes);
  const valid =
    mime === "font/ttf" || mime === "font/otf"
      ? sfnt(bytes)
      : mime === "font/woff"
        ? woff(bytes)
        : mime === "font/woff2"
          ? woff2(bytes)
          : false;
  if (!mime || !valid)
    throw new Error(
      "Only single TrueType, OpenType, WOFF or WOFF2 font files are supported.",
    );
  return mime;
}

export function fontDisplayName(name: string) {
  return (
    path
      .basename(name)
      .replace(/\.(ttf|otf|woff2?)$/i, "")
      .replace(/[^a-zA-Z0-9._ -]/g, "_")
      .slice(0, 100) || "Font"
  );
}

export async function storeFont(
  bytes: Buffer,
  name: string,
  license: string,
  maxBytes: number = MAX_MEDIA_UPLOAD_BYTES.font,
  options: MediaNormalizationOptions = {},
): Promise<Asset> {
  const id = normalizationId(options);
  if (bytes.length > Math.min(maxBytes, MAX_MEDIA_UPLOAD_BYTES.font))
    throw new Error("Fonts must be 5 MB or smaller.");
  const mime = validateFont(bytes);
  assertNormalizationActive(options);
  writeNormalizedMedia(id, bytes, options);
  return {
    id,
    name: fontDisplayName(name),
    source: "User upload",
    license,
    mime,
    bytes: bytes.length,
    createdAt: new Date().toISOString(),
  };
}
