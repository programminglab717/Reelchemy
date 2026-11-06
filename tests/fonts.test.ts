import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import Database from "better-sqlite3";
import { unzipSync, strFromU8, zipSync, strToU8 } from "fflate";
import { blankTimeline } from "../src/lib/editor";
import {
  layerSchema,
  timelineSchema,
  type Asset,
  type Project,
} from "../src/lib/schema";
import { layerFontFamily, textStyle } from "../src/lib/text-style";
import { inspectTimeline } from "../src/lib/qc";
import { validateProjectAssets } from "../src/lib/project-assets";
import { listLibraryMedia } from "../src/lib/media-library";
import { sceneCacheKey } from "../src/lib/render-cache";

const root = await mkdtemp(path.join(tmpdir(), "reelchemy-fonts-"));
process.env.REELCHEMY_DATA_DIR = path.join(root, "data");
const { validateFont, sniffFontMime, storeFont, fontDisplayName } =
  await import("../src/lib/fonts");
const { exportArchive, importArchive } = await import("../src/lib/archive");
const { serveRenderAssets } = await import("../src/lib/render-assets");
const { assetDir } = await import("../src/lib/assets");
after(() => rm(root, { recursive: true, force: true }));

// A real OFL-licensed WOFF2 shipped inside the pinned Next.js package.
const require = createRequire(import.meta.url);
const woff2 = await readFile(
  path.join(
    path.dirname(require.resolve("next/package.json")),
    "dist/next-devtools/server/font/geist-mono-latin.woff2",
  ),
);

// Minimal structurally valid SFNT container (tables are placeholders: only
// Chromium parses glyph data, the server checks the directory).
function sfnt(
  signature: string | number,
  tags = ["cmap", "glyf", "head", "name"],
) {
  const header = 12 + tags.length * 16;
  const bytes = Buffer.alloc(header + tags.length * 4);
  if (typeof signature === "number") bytes.writeUInt32BE(signature, 0);
  else bytes.write(signature, 0, "latin1");
  bytes.writeUInt16BE(tags.length, 4);
  tags.forEach((tag, i) => {
    const record = 12 + i * 16;
    bytes.write(tag, record, "latin1");
    bytes.writeUInt32BE(header + i * 4, record + 8);
    bytes.writeUInt32BE(4, record + 12);
  });
  return bytes;
}
function woff(tables = 1, length?: number) {
  const bytes = Buffer.alloc(44 + tables * 20 + tables * 4);
  bytes.write("wOFF", 0, "latin1");
  bytes.writeUInt32BE(0x00010000, 4);
  bytes.writeUInt32BE(length ?? bytes.length, 8);
  bytes.writeUInt16BE(tables, 12);
  for (let i = 0; i < tables; i++) {
    const record = 44 + i * 20;
    bytes.write("cmap", record, "latin1");
    bytes.writeUInt32BE(44 + tables * 20 + i * 4, record + 4);
    bytes.writeUInt32BE(4, record + 8);
    bytes.writeUInt32BE(8, record + 12);
  }
  return bytes;
}

test("font uploads are recognised by their container and structurally checked", () => {
  assert.equal(validateFont(woff2), "font/woff2");
  assert.equal(validateFont(sfnt(0x00010000)), "font/ttf");
  assert.equal(validateFont(sfnt("true")), "font/ttf");
  assert.equal(
    validateFont(sfnt("OTTO", ["CFF ", "cmap", "head", "name"])),
    "font/otf",
  );
  assert.equal(validateFont(woff()), "font/woff");
  const reject = (bytes: Buffer) => assert.throws(() => validateFont(bytes));
  // Not fonts, collections, truncated or inconsistent containers.
  reject(Buffer.from("\x89PNG\r\n\x1a\n0000000000"));
  reject(Buffer.from("ttcf" + "\0".repeat(40), "latin1"));
  reject(sfnt(0x00010000).subarray(0, 40));
  reject(sfnt(0x00010000, ["cmap", "head", "name"]));
  const outside = sfnt(0x00010000);
  outside.writeUInt32BE(10000, 12 + 8);
  reject(outside);
  reject(woff(1, 9999));
  const compressedLarger = woff();
  compressedLarger.writeUInt32BE(9, 44 + 8);
  reject(compressedLarger);
  reject(woff2.subarray(0, woff2.length - 1));
  assert.equal(sniffFontMime(Buffer.from("nothing at all")), null);
  assert.equal(fontDisplayName("../Brand Sans-Bold.woff2"), "Brand Sans-Bold");
});

test("stored fonts keep their bytes and refuse oversized files", async () => {
  const asset = await storeFont(woff2, "Geist Mono.woff2", "OFL 1.1");
  assert.equal(asset.mime, "font/woff2");
  assert.equal(asset.name, "Geist Mono");
  assert.equal(asset.bytes, woff2.length);
  assert.deepEqual(await readFile(path.join(assetDir, asset.id)), woff2);
  await assert.rejects(
    storeFont(Buffer.alloc(5 * 1024 * 1024 + 1), "big.ttf", "Mine"),
    /5 MB/,
  );
  await assert.rejects(storeFont(Buffer.from("plain text file"), "a.ttf", "x"));
});

const brief = { prompt: "Brand fonts", duration: 5, format: "square" as const };
const fontId = randomUUID();
function withFont(id: string = fontId, kind: "text" | "rectangle" = "text") {
  const timeline = blankTimeline(brief);
  timeline.scenes[0].layers = [
    {
      ...timeline.scenes[0].layers[0],
      kind,
      text: kind === "text" ? "Brand" : "",
      fontAssetId: id,
    },
  ];
  return timeline;
}

test("only text layers reference fonts, and only this project's font assets", () => {
  assert.equal(timelineSchema.safeParse(withFont()).success, true);
  assert.equal(
    timelineSchema.safeParse(withFont(fontId, "rectangle")).success,
    false,
  );
  assert.equal(
    layerSchema.safeParse({
      ...withFont().scenes[0].layers[0],
      fontAssetId: "x",
    }).success,
    false,
  );
  const font: Asset = {
    id: fontId,
    name: "Brand",
    source: "User upload",
    license: "Mine",
    mime: "font/woff2",
    createdAt: new Date().toISOString(),
  };
  const timeline = timelineSchema.parse(withFont());
  validateProjectAssets({ assets: [font] }, timeline);
  assert.throws(() => validateProjectAssets({ assets: [] }, timeline));
  assert.throws(() =>
    validateProjectAssets(
      { assets: [{ ...font, mime: "image/png" }] },
      timeline,
    ),
  );
  // QC reports a missing font; the preview/export family keeps a fallback.
  assert(
    inspectTimeline(timeline, []).some(
      (i) => i.code === "missing-asset" && i.message.includes("font"),
    ),
  );
  assert(
    !inspectTimeline(timeline, [fontId]).some(
      (i) => i.code === "missing-asset",
    ),
  );
  const layer = timeline.scenes[0].layers[0];
  assert.equal(
    layerFontFamily(layer),
    `"reelchemy-font-${fontId}", Arial, sans-serif`,
  );
  assert.equal(
    textStyle({ ...layer, fontFamily: "serif" }, 1280).fontFamily,
    `"reelchemy-font-${fontId}", Georgia, serif`,
  );
  // Cached scenes are invalidated when the font file changes.
  assert.notEqual(
    sceneCacheKey(timeline, {}, "source", { [fontId]: "a" }),
    sceneCacheKey(timeline, {}, "source", { [fontId]: "b" }),
  );
});

test("archives carry uploaded fonts under their own required feature", async () => {
  const font = await storeFont(woff2, "Brand.woff2", "OFL 1.1");
  const project: Project = {
    id: randomUUID(),
    name: "Font archive",
    brief,
    timeline: timelineSchema.parse(withFont(font.id)),
    assets: [font],
    messages: [],
    createdAt: new Date().toISOString(),
    revisions: [],
  };
  const archive = await exportArchive(project);
  const files = unzipSync(archive);
  const envelope = JSON.parse(strFromU8(files["project.json"]));
  assert.equal(envelope.version, 5);
  assert.deepEqual(envelope.requiredFeatures, ["custom-font-v1"]);
  const restored = await importArchive(archive);
  const copy = restored.assets!.find((a) => a.mime === "font/woff2")!;
  assert.notEqual(copy.id, font.id);
  assert.equal(restored.timeline!.scenes[0].layers[0].fontAssetId, copy.id);
  assert.deepEqual(await readFile(path.join(assetDir, copy.id)), woff2);
  // Older envelopes, missing features and disguised payloads are refused.
  const rezip = (changes: Record<string, unknown>, asset = woff2) =>
    zipSync({
      "project.json": strToU8(JSON.stringify({ ...envelope, ...changes })),
      [`assets/${font.id}`]: new Uint8Array(asset),
    });
  await assert.rejects(
    importArchive(rezip({ requiredFeatures: undefined, version: 1 })),
  );
  await assert.rejects(
    importArchive(rezip({ requiredFeatures: ["layer-mask-v1"] })),
  );
  await assert.rejects(
    importArchive(rezip({}, Buffer.from("not really a font file at all"))),
  );
});

test("exports serve fonts with their verified type, and the library lists them", async () => {
  const font = await storeFont(woff2, "Brand.woff2", "OFL 1.1");
  const media = await serveRenderAssets(
    timelineSchema.parse(withFont(font.id)),
  );
  try {
    const response = await fetch(media.sources[font.id]);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "font/woff2");
    assert.equal(response.headers.get("access-control-allow-origin"), "*");
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), woff2);
  } finally {
    await media.close();
  }
  const db = new Database(":memory:");
  db.exec(
    "CREATE TABLE projects(id TEXT PRIMARY KEY, workspace_id TEXT, data TEXT, trashed_at TEXT); CREATE TABLE project_deletions(project_id TEXT)",
  );
  const image = { ...font, id: randomUUID(), mime: "image/png", name: "Logo" };
  db.prepare("INSERT INTO projects VALUES (?,?,?,NULL)").run(
    "p1",
    "w1",
    JSON.stringify({ name: "Brand kit", assets: [font, image] }),
  );
  const list = (kind: "all" | "font" | "image") =>
    listLibraryMedia(db, "w1", { query: "", kind, offset: 0, limit: 10 })
      .items.map((item) => item.asset.mime)
      .sort();
  assert.deepEqual(list("all"), ["font/woff2", "image/png"]);
  assert.deepEqual(list("font"), ["font/woff2"]);
  assert.deepEqual(list("image"), ["image/png"]);
});
