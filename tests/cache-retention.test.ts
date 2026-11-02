import { test, after } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  readdirSync,
  existsSync,
  utimesSync,
  lstatSync,
  linkSync,
  renameSync,
  symlinkSync,
  unlinkSync,
  rmSync,
  openSync,
  closeSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  cacheRetentionPolicy,
  CacheRetentionUnavailable,
  type CacheRetentionPolicy,
} from "../src/lib/cache-retention-policy";
import {
  planSceneCacheRetention,
  applySceneCacheRetention,
  openSceneCacheNamespace,
  removeSceneCacheNamespace,
} from "../src/lib/cache-retention";
const root = mkdtempSync(path.join(tmpdir(), "reelchemy-cache-retention-"));
Object.assign(process.env, {
  REELCHEMY_DATA_DIR: path.join(root, "data"),
  REELCHEMY_AUTH_DIR: path.join(root, "auth"),
  REELCHEMY_ARTIFACT_DIR: path.join(root, "exports"),
});
for (const directory of ["data", "auth", "exports"])
  mkdirSync(path.join(root, directory));
after(() => rmSync(root, { recursive: true, force: true }));
const now = Date.now();
const policy: CacheRetentionPolicy = {
  totalBytes: 100000,
  workspaceBytes: 100000,
  entries: 100,
  maxAgeMs: 86400000,
};
function fixture() {
  const directory = path.join(root, randomUUID(), "cache");
  mkdirSync(directory, { recursive: true });
  return directory;
}
function clip(
  directory: string,
  studio: string,
  key: string,
  age = 0,
  bytes = 100,
) {
  const target = path.join(directory, studio, key);
  mkdirSync(target, { recursive: true });
  writeFileSync(path.join(target, "video.mp4"), Buffer.alloc(bytes, 37));
  writeFileSync(
    path.join(target, "manifest.json"),
    JSON.stringify({ key, frames: 30, sha256: "a".repeat(64) }),
  );
  for (const name of ["video.mp4", "manifest.json"])
    utimesSync(path.join(target, name), (now - age) / 1000, (now - age) / 1000);
  return {
    target,
    bytes:
      lstatSync(path.join(target, "video.mp4")).size +
      lstatSync(path.join(target, "manifest.json")).size,
  };
}
function digest(file: string) {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}
function refusal(operation: () => unknown) {
  assert.throws(
    operation,
    (error: unknown) =>
      error instanceof CacheRetentionUnavailable &&
      !error.message.includes(root),
  );
}
test("cache retention policy is bounded and rejects malformed or inconsistent operator settings", () => {
  assert.deepEqual(cacheRetentionPolicy({}), {
    totalBytes: 1024 ** 3,
    workspaceBytes: 256 * 1024 ** 2,
    entries: 5000,
    maxAgeMs: 7 * 86400000,
  });
  for (const value of [
    "",
    "0",
    "-1",
    "NaN",
    "Infinity",
    "1e9",
    " 10000000",
    "999999999999999999999",
  ])
    refusal(() => cacheRetentionPolicy({ REELCHEMY_SCENE_CACHE_BYTES: value }));
  refusal(() =>
    cacheRetentionPolicy({ REELCHEMY_SCENE_CACHE_BYTES: String(1024 ** 2) }),
  );
  refusal(() =>
    cacheRetentionPolicy({ REELCHEMY_SCENE_CACHE_ENTRIES: "20001" }),
  );
  refusal(() => cacheRetentionPolicy({ REELCHEMY_SCENE_CACHE_DAYS: "91" }));
});
test("inspection is read-only, including absent roots, and plans exact managed logical bytes", () => {
  const directory = fixture(),
    studio = randomUUID();
  const a = clip(directory, studio, "a".repeat(64));
  const before = digest(path.join(a.target, "video.mp4"));
  const names = readdirSync(directory),
    modified = lstatSync(directory).mtimeMs;
  const plan = planSceneCacheRetention(policy, directory, now);
  assert.equal(plan.report.bytes, a.bytes);
  assert.equal(plan.report.managed, false);
  assert.equal(plan.remove.length, 0);
  assert.deepEqual(readdirSync(directory), names);
  assert.equal(lstatSync(directory).mtimeMs, modified);
  assert.equal(digest(path.join(a.target, "video.mp4")), before);
  const absent = path.join(root, "absent-cache");
  assert.equal(
    planSceneCacheRetention(policy, absent, now).report.exists,
    false,
  );
  assert.equal(existsSync(absent), false);
});
test("per-studio least-recently-used eviction preserves other studios, original uploads, private accounts and finished exports", () => {
  const directory = fixture(),
    owner = randomUUID(),
    other = randomUUID();
  const oldest = clip(directory, owner, "a".repeat(64), 3000),
    recent = clip(directory, owner, "b".repeat(64), 1000),
    unrelated = clip(directory, other, "c".repeat(64), 2000);
  const canaries = ["data", "auth", "exports"].map((name) =>
    path.join(root, name, "video.mp4"),
  );
  for (const file of canaries) writeFileSync(file, `keep original ${file}`);
  const before = canaries.map(digest);
  const plan = planSceneCacheRetention(
    { ...policy, workspaceBytes: recent.bytes },
    directory,
    now,
  );
  assert.deepEqual(plan.remove, [
    { namespace: owner, key: "a".repeat(64), reason: "studio" },
  ]);
  const report = applySceneCacheRetention(plan);
  assert.equal(report.managed, true);
  assert.equal(report.retainedEntries, 2);
  assert.equal(existsSync(oldest.target), false);
  assert.equal(existsSync(recent.target), true);
  assert.equal(existsSync(unrelated.target), true);
  assert.deepEqual(canaries.map(digest), before);
});
test("shared byte and entry limits evict globally old clips without removing namespaces that still contain retained clips", () => {
  const directory = fixture(),
    studio = randomUUID();
  const oldest = clip(directory, studio, "a".repeat(64), 3000),
    middle = clip(directory, randomUUID(), "b".repeat(64), 2000),
    recent = clip(directory, studio, "c".repeat(64), 1000);
  const plan = planSceneCacheRetention(
    { ...policy, totalBytes: 2 * recent.bytes, entries: 1 },
    directory,
    now,
  );
  assert.equal(plan.remove.length, 2);
  assert(plan.remove.every((entry) => entry.reason === "shared"));
  const report = applySceneCacheRetention(plan);
  assert.equal(report.retainedEntries, 1);
  assert.equal(report.retainedBytes, recent.bytes);
  assert.equal(existsSync(oldest.target), false);
  assert.equal(existsSync(middle.target), false);
  assert.equal(existsSync(recent.target), true);
});
test("expired clips and interrupted partial captures are reclaimed, counting hard-linked still frames once", () => {
  const directory = fixture(),
    studio = randomUUID();
  const expired = clip(directory, studio, "a".repeat(64), 2000),
    retained = clip(directory, studio, "b".repeat(64), 100);
  const partial = path.join(directory, studio, `.partial-${randomUUID()}`),
    frames = path.join(partial, "static-AbC123");
  mkdirSync(frames, { recursive: true });
  writeFileSync(path.join(frames, "frame-0000.jpeg"), Buffer.alloc(50));
  linkSync(
    path.join(frames, "frame-0000.jpeg"),
    path.join(frames, "frame-0001.jpeg"),
  );
  const plan = planSceneCacheRetention(
    { ...policy, maxAgeMs: 1000 },
    directory,
    now,
  );
  assert.equal(plan.report.bytes, expired.bytes + retained.bytes + 50);
  assert.deepEqual(
    new Set(plan.remove.map((entry) => entry.reason)),
    new Set(["expired", "interrupted"]),
  );
  applySceneCacheRetention(plan);
  assert.equal(existsSync(partial), false);
  assert.equal(existsSync(expired.target), false);
  assert.equal(existsSync(retained.target), true);
});
test("configured source/account/export roots and their ancestors can never be adopted as a cache", () => {
  for (const directory of [
    root,
    path.join(root, "data"),
    path.join(root, "data", "assets"),
    path.join(root, "data", "media-inputs"),
    path.join(root, "data", "waveforms", "nested"),
    path.join(root, "exports", randomUUID()),
    path.join(root, "auth"),
    path.join(root, "auth", "nested"),
    path.join(root, "exports"),
  ]) {
    refusal(() => planSceneCacheRetention(policy, directory, now));
    assert.equal(
      existsSync(path.join(directory, ".reelchemy-scene-cache-v1")),
      false,
    );
  }
});
test("namespace, entry, video and ownership-marker symlinks refuse without touching external canaries", () => {
  for (const kind of ["namespace", "entry", "video", "marker"]) {
    const directory = fixture(),
      studio = randomUUID();
    const cached = clip(directory, studio, "a".repeat(64));
    const external = path.join(root, randomUUID());
    mkdirSync(external);
    const canary = path.join(external, "private-canary");
    writeFileSync(canary, "Never delete private data");
    const before = digest(canary);
    if (kind === "namespace") {
      rmSync(path.join(directory, studio), { recursive: true });
      symlinkSync(external, path.join(directory, studio));
    }
    if (kind === "entry") {
      rmSync(cached.target, { recursive: true });
      symlinkSync(external, cached.target);
    }
    if (kind === "video") {
      unlinkSync(path.join(cached.target, "video.mp4"));
      symlinkSync(canary, path.join(cached.target, "video.mp4"));
    }
    if (kind === "marker")
      symlinkSync(canary, path.join(directory, ".reelchemy-scene-cache-v1"));
    refusal(() => planSceneCacheRetention(policy, directory, now));
    assert.equal(digest(canary), before);
  }
});
test("a root or namespace replaced after inspection invalidates the plan without deleting either tree", () => {
  for (const kind of ["root", "namespace"]) {
    const directory = fixture(),
      studio = randomUUID();
    const cached = clip(directory, studio, "a".repeat(64), 1000);
    const plan = planSceneCacheRetention(
      { ...policy, maxAgeMs: 1 },
      directory,
      now,
    );
    const external = path.join(root, randomUUID());
    mkdirSync(external);
    const canary = path.join(external, "private-canary");
    writeFileSync(canary, "Keep external");
    const retained = path.join(root, randomUUID());
    if (kind === "root") {
      renameSync(directory, retained);
      symlinkSync(external, directory);
    } else {
      renameSync(path.join(directory, studio), retained);
      symlinkSync(external, path.join(directory, studio));
    }
    refusal(() => applySceneCacheRetention(plan));
    assert.equal(readFileSync(canary, "utf8"), "Keep external");
    assert.equal(
      existsSync(
        kind === "root"
          ? path.join(retained, studio, "a".repeat(64), "video.mp4")
          : path.join(retained, "a".repeat(64), "video.mp4"),
      ),
      true,
    );
    assert.equal(
      existsSync(path.join(external, ".reelchemy-scene-cache-v1")),
      false,
    );
    assert.equal(existsSync(cached.target), false);
  }
});
test("a changed cached file invalidates inspection before any other selected clip is removed", () => {
  const directory = fixture(),
    studio = randomUUID();
  const a = clip(directory, studio, "a".repeat(64), 1000),
    b = clip(directory, studio, "b".repeat(64), 1000);
  const plan = planSceneCacheRetention(
    { ...policy, maxAgeMs: 1 },
    directory,
    now,
  );
  const video = path.join(a.target, "video.mp4"),
    fd = openSync(video, "r");
  try {
    unlinkSync(video);
    writeFileSync(video, "Replacement cache bytes");
    refusal(() => applySceneCacheRetention(plan));
  } finally {
    closeSync(fd);
  }
  assert.equal(readFileSync(video, "utf8"), "Replacement cache bytes");
  assert.equal(existsSync(b.target), true);
});
test("evicting a cache hard link preserves the external source inode and bytes", () => {
  const directory = fixture(),
    studio = randomUUID();
  const cached = clip(directory, studio, "a".repeat(64), 1000);
  const original = path.join(root, "data", randomUUID());
  writeFileSync(original, "Original source survives");
  const before = digest(original);
  unlinkSync(path.join(cached.target, "video.mp4"));
  linkSync(original, path.join(cached.target, "video.mp4"));
  applySceneCacheRetention(
    planSceneCacheRetention({ ...policy, maxAgeMs: 1 }, directory, now),
  );
  assert.equal(existsSync(cached.target), false);
  assert.equal(digest(original), before);
  assert.equal(lstatSync(original).nlink, 1);
});
test("an opened cache namespace remains pinned across parent replacement and is usable by native child processes", () => {
  const directory = fixture(),
    studio = randomUUID();
  process.env.REELCHEMY_RENDER_CACHE_DIR = directory;
  const handle = openSceneCacheNamespace(studio);
  const retained = path.join(root, randomUUID()),
    external = path.join(root, randomUUID());
  mkdirSync(external);
  writeFileSync(path.join(external, "private-canary"), "Keep external");
  renameSync(directory, retained);
  symlinkSync(external, directory);
  const name = `.partial-${randomUUID()}`;
  try {
    execFileSync(process.execPath, [
      "-e",
      "require('node:fs').mkdirSync(require('node:path').join(process.argv[1],process.argv[2]));",
      handle.directory,
      name,
    ]);
    assert.equal(existsSync(path.join(retained, studio, name)), true);
    assert.equal(existsSync(path.join(external, name)), false);
    assert.equal(
      readFileSync(path.join(external, "private-canary"), "utf8"),
      "Keep external",
    );
  } finally {
    handle.close();
  }
});
test("unknown files refuse adoption and leave every known cache clip intact", () => {
  const directory = fixture(),
    studio = randomUUID();
  const cached = clip(directory, studio, "a".repeat(64), 1000);
  const unexpected = path.join(cached.target, "user-film.mov");
  writeFileSync(unexpected, "Do not infer ownership from a containing path");
  refusal(() =>
    planSceneCacheRetention({ ...policy, maxAgeMs: 1 }, directory, now),
  );
  assert.equal(
    readFileSync(unexpected, "utf8"),
    "Do not infer ownership from a containing path",
  );
  assert.equal(existsSync(path.join(cached.target, "video.mp4")), true);
});

test("project cleanup clears only the selected closed cache namespace and preserves unknown data", () => {
  const directory = fixture(),
    owner = randomUUID(),
    other = randomUUID();
  process.env.REELCHEMY_RENDER_CACHE_DIR = directory;
  const a = clip(directory, owner, "a".repeat(64)),
    b = clip(directory, other, "b".repeat(64));
  const before = digest(path.join(b.target, "video.mp4"));
  removeSceneCacheNamespace(owner);
  assert.equal(existsSync(a.target), false);
  assert.equal(digest(path.join(b.target, "video.mp4")), before);
  const replacement = clip(directory, owner, "c".repeat(64));
  writeFileSync(
    path.join(replacement.target, "unknown-user-film.mov"),
    "Preserve unknown data",
  );
  refusal(() => removeSceneCacheNamespace(owner));
  assert.equal(
    readFileSync(
      path.join(replacement.target, "unknown-user-film.mov"),
      "utf8",
    ),
    "Preserve unknown data",
  );
  assert.equal(digest(path.join(b.target, "video.mp4")), before);
});
test("project cache cleanup unlinks its namespace pointer without following an external target and refuses protected roots", () => {
  const directory = fixture(),
    owner = randomUUID(),
    external = path.join(root, randomUUID());
  mkdirSync(external);
  const canary = path.join(external, "private-canary");
  writeFileSync(canary, "Preserve external data");
  symlinkSync(external, path.join(directory, owner));
  process.env.REELCHEMY_RENDER_CACHE_DIR = directory;
  removeSceneCacheNamespace(owner);
  assert.equal(existsSync(path.join(directory, owner)), false);
  assert.equal(readFileSync(canary, "utf8"), "Preserve external data");
  process.env.REELCHEMY_RENDER_CACHE_DIR = path.join(root, "exports");
  refusal(() => removeSceneCacheNamespace(owner));
  assert.equal(readFileSync(canary, "utf8"), "Preserve external data");
});
