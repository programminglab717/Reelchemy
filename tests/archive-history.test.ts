import { test, after } from "node:test";
import assert from "node:assert/strict";
import { MAX_STORED_ASSET_BYTES } from "../src/lib/timeline-limits";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  symlinkSync,
  unlinkSync,
  renameSync,
  openSync,
  ftruncateSync,
  closeSync,
  rmSync,
} from "node:fs";
import sharp from "sharp";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { tmpdir } from "node:os";
import { randomUUID, createHash } from "node:crypto";
import { zipSync, unzipSync, strToU8, strFromU8 } from "fflate";
import { blankTimeline } from "../src/lib/editor";
import type { Project } from "../src/lib/schema";

// This process owns its root; unsafe-directory fixtures cannot affect other
// unit files running concurrently or any operator's actual media.
const root = mkdtempSync(path.join(tmpdir(), "reelchemy-archive-history-"));
process.env.REELCHEMY_DATA_DIR = path.join(root, "data");
const { exportArchive, importArchive } = await import("../src/lib/archive");
const { assetDir } = await import("../src/lib/assets");
after(() => rmSync(root, { recursive: true, force: true }));
function project(count = 1, messages = 1): Project {
  const brief = {
    prompt: "Keep all edits",
    duration: 5,
    format: "landscape" as const,
  };
  const timeline = blankTimeline(brief);
  const createdAt = "2026-11-02T12:00:00.000Z";
  return {
    id: randomUUID(),
    name: "Portable edits",
    createdAt,
    brief,
    timeline,
    assets: [],
    messages: Array.from({ length: messages }, (_, index) => ({
      role: "user",
      content: `Direction ${index}`,
    })),
    revisions: Array.from({ length: count }, (_, index) => ({
      id: `edit-${index}`,
      createdAt,
      source: `Cut ${index}`,
      timeline: structuredClone(timeline),
    })),
  };
}
function zip(envelope: unknown) {
  return zipSync({ "project.json": strToU8(JSON.stringify(envelope)) });
}
function hash(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
test("large retained history and conversation round trip in an explicit format, with rotation and no source mutation", async () => {
  for (const rotation of [0, 35]) {
    const source = project(501, 1001);
    source.revisions[0].timeline.scenes[0].layers[0].rotation = rotation;
    const before = hash(source);
    const bytes = await exportArchive({
      ...source,
      privateServerExtra: "must not travel",
    } as Project);
    const envelope = JSON.parse(strFromU8(unzipSync(bytes)["project.json"]));
    assert.equal(envelope.version, 3);
    assert.deepEqual(
      envelope.requiredFeatures,
      rotation
        ? ["large-history-v1", "layer-rotation-v1"]
        : ["large-history-v1"],
    );
    assert.equal(envelope.project.privateServerExtra, undefined);
    const restored = await importArchive(bytes);
    assert.equal(restored.revisions.length, 501);
    assert.deepEqual(restored.revisions, source.revisions);
    assert.deepEqual(restored.messages, source.messages);
    assert.deepEqual(restored.timeline, source.timeline);
    assert.notEqual(restored.id, source.id);
    assert.equal(hash(source), before);
  }
});
test("legacy archives retain their advertised limits and new archives refuse undeclared features", async () => {
  const source = project(500, 1000);
  const bytes = await exportArchive(source);
  const envelope = JSON.parse(strFromU8(unzipSync(bytes)["project.json"]));
  assert.equal(envelope.version, 1);
  assert.equal((await importArchive(bytes)).revisions.length, 500);
  await assert.rejects(
    importArchive(
      zip({ format: "reelchemy", version: 1, project: project(501) }),
    ),
    /500 revisions/,
  );
  for (const features of [
    [],
    ["layer-rotation-v1"],
    ["large-history-v1", "large-history-v1"],
    ["large-history-v1", "unknown"],
  ]) {
    let registered = false;
    await assert.rejects(
      importArchive(
        zip({
          format: "reelchemy",
          version: 3,
          requiredFeatures: features,
          project: project(),
        }),
        {
          registerOutputs: () => {
            registered = true;
          },
        },
      ),
    );
    assert.equal(registered, false);
  }
});
test("count admission refuses hostile collections before recursive validation or output registration", async () => {
  for (const [key, limit] of [
    ["revisions", 10000],
    ["messages", 10000],
    ["assets", 30],
  ] as const) {
    const source = { ...project(), [key]: Array(limit + 1).fill(null) };
    const expected = new RegExp(`up to ${limit} ${key}`);
    await assert.rejects(exportArchive(source as Project), expected);
    let registered = false;
    await assert.rejects(
      importArchive(
        zip({
          format: "reelchemy",
          version: 3,
          requiredFeatures: ["large-history-v1"],
          project: source,
        }),
        {
          registerOutputs: () => {
            registered = true;
          },
        },
      ),
      expected,
    );
    assert.equal(registered, false);
  }
});
test("the independent 10 MB manifest cap preserves the source instead of silently pruning edits", async () => {
  const source = project(1, 1800);
  for (const message of source.messages) message.content = "x".repeat(6000);
  const before = hash(source);
  await assert.rejects(exportArchive(source), /history is too large/);
  await assert.rejects(
    importArchive(
      zip({
        format: "reelchemy",
        version: 3,
        requiredFeatures: ["large-history-v1"],
        project: source,
      }),
    ),
    /exceeds extraction limits/,
  );
  assert.equal(hash(source), before);
});
test("import repairs ambiguous legacy version identities only in the imported copy", async () => {
  const source = project(6);
  const ids = [
    "duplicate",
    "duplicate",
    "",
    "bad\u0000id",
    "old/α?edit",
    "kept",
  ];
  source.revisions.forEach((revision, index) => {
    revision.id = ids[index];
  });
  const restored = await importArchive(await exportArchive(source));
  assert.equal(
    new Set(restored.revisions.map((revision) => revision.id)).size,
    6,
  );
  for (let i = 0; i < 4; i++)
    assert.match(restored.revisions[i].id, /^[a-f0-9-]{36}$/);
  assert.deepEqual(
    restored.revisions.slice(4).map((revision) => revision.id),
    ids.slice(4),
  );
  assert.deepEqual(
    source.revisions.map((revision) => revision.id),
    ids,
  );
  assert.deepEqual(
    restored.revisions.map((revision) => revision.timeline),
    source.revisions.map((revision) => revision.timeline),
  );
});
function assetProject() {
  mkdirSync(assetDir, { recursive: true });
  const source = project();
  const id = randomUUID();
  source.assets = [
    {
      id,
      name: "safe.png",
      license: "Test owned",
      source: "Test",
      mime: "image/png",
      createdAt: source.createdAt,
    },
  ];
  return { source, file: path.join(assetDir, id) };
}
async function refused(source: Project) {
  await assert.rejects(exportArchive(source), (error: unknown) => {
    assert(error instanceof Error);
    assert.match(
      error.message,
      /archived asset is missing, unsafe, changed, or exceeds portable limits/,
    );
    assert(!error.message.includes(root));
    return true;
  });
}
test("archive reads reject symlinks, missing files, directories, FIFOs and oversized regular files without private path errors", async () => {
  const { source, file } = assetProject();
  const canary = path.join(root, "private-canary");
  writeFileSync(canary, "not archive media");
  await refused(source);
  symlinkSync(canary, file);
  await refused(source);
  unlinkSync(file);
  mkdirSync(file);
  await refused(source);
  rmSync(file, { recursive: true });
  execFileSync("mkfifo", [file]);
  await refused(source);
  unlinkSync(file);
  const fd = openSync(file, "w");
  ftruncateSync(fd, MAX_STORED_ASSET_BYTES + 1);
  closeSync(fd);
  await refused(source);
  unlinkSync(file);
  assert.equal(readFileSync(canary, "utf8"), "not archive media");
});
test("an asset-directory symlink cannot read external files or leak private paths", async () => {
  const { source, file } = assetProject();
  const external = path.join(root, "external");
  mkdirSync(external);
  const canary = path.join(external, path.basename(file));
  writeFileSync(canary, "external canary");
  const retained = `${assetDir}-retained`;
  renameSync(assetDir, retained);
  symlinkSync(external, assetDir);
  try {
    await refused(source);
  } finally {
    unlinkSync(assetDir);
    renameSync(retained, assetDir);
  }
  assert.equal(readFileSync(canary, "utf8"), "external canary");
});

test("failed imports remove only new anchored outputs and preserve original assets", async () => {
  const { source, file } = assetProject();
  const png = await sharp({
    create: { width: 4, height: 4, channels: 3, background: "#27b4a9" },
  })
    .png()
    .toBuffer();
  writeFileSync(file, png);
  source.timeline!.scenes[0].layers[0].assetId = randomUUID();
  let outputs: string[] = [];
  await assert.rejects(
    importArchive(
      zipSync({
        "project.json": strToU8(
          JSON.stringify({ format: "reelchemy", version: 1, project: source }),
        ),
        [`assets/${source.assets![0].id}`]: png,
      }),
      {
        registerOutputs: (ids) => {
          outputs = ids;
        },
      },
    ),
    /Invalid image reference/,
  );
  assert.equal(outputs.length, 1);
  assert.equal(existsSync(path.join(assetDir, outputs[0])), false);
  assert.deepEqual(readFileSync(file), png);
});
test("interrupted import cleanup refuses a replaced asset directory and preserves its external canary", async () => {
  const source = project();
  const png = await sharp({
    create: { width: 4, height: 4, channels: 3, background: "#27b4a9" },
  })
    .png()
    .toBuffer();
  source.assets = Array.from({ length: 2 }, () => ({
    id: randomUUID(),
    name: "art.png",
    license: "Test owned",
    source: "Test",
    mime: "image/png",
    createdAt: source.createdAt,
  }));
  const files = Object.fromEntries(
    source.assets.map((asset) => [`assets/${asset.id}`, png]),
  );
  const external = path.join(root, "cleanup-external");
  const retained = `${assetDir}-cleanup-retained`;
  mkdirSync(external);
  let outputs: string[] = [];
  let seen = 0;
  let replaced = false;
  try {
    await assert.rejects(
      importArchive(
        zipSync({
          ...files,
          "project.json": strToU8(
            JSON.stringify({
              format: "reelchemy",
              version: 1,
              project: source,
            }),
          ),
        }),
        {
          registerOutputs: (ids) => {
            outputs = ids;
            writeFileSync(
              path.join(external, ids[0]),
              "do not remove external canary",
            );
          },
          cancelled: () => {
            if (
              outputs[0] &&
              existsSync(path.join(assetDir, outputs[0])) &&
              ++seen === 2
            ) {
              renameSync(assetDir, retained);
              symlinkSync(external, assetDir);
              replaced = true;
              return true;
            }
            return false;
          },
        },
      ),
      /cancelled/i,
    );
    assert.equal(replaced, true);
    assert.equal(
      readFileSync(path.join(external, outputs[0]), "utf8"),
      "do not remove external canary",
    );
    assert.equal(
      existsSync(path.join(retained, outputs[0])),
      true,
      "unsafe cleanup retains the registered output for durable worker retry",
    );
  } finally {
    if (replaced) {
      unlinkSync(assetDir);
      renameSync(retained, assetDir);
    }
  }
});
