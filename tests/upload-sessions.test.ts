import { test, after } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  rm,
  readFile,
  writeFile,
  readdir,
  utimes,
} from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import {
  UploadSessionStore,
  UploadOffsetConflict,
  UploadSessionGone,
} from "../src/lib/upload-sessions";
import { mediaProcessingPolicy } from "../src/lib/media-processing-policy";
import { MediaInputFiles } from "../src/lib/media-input-files";
import {
  MAX_MEDIA_UPLOAD_BYTES,
  UPLOAD_CHUNK_BYTES,
} from "../src/lib/timeline-limits";

const root = await mkdtemp(path.join(tmpdir(), "reelchemy-upload-sessions-"));
after(() => rm(root, { recursive: true, force: true }));
const sha = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");
function setup(env: Record<string, string> = {}) {
  const dir = path.join(root, randomUUID());
  const db = new Database(":memory:");
  db.exec("CREATE TABLE workspaces(id TEXT PRIMARY KEY)");
  let now = 1_000_000;
  const store = new UploadSessionStore(
    db,
    dir,
    () => mediaProcessingPolicy(env),
    () => now,
  );
  return {
    db,
    dir,
    store,
    advance: (ms: number) => (now += ms),
  };
}
const upload = (bytes: number, kind: "video" | "image" = "video") => ({
  operation: "upload" as const,
  projectId: "project-1",
  kind,
  name: "Clip.mp4",
  license: "Owned footage",
  bytes,
});

test("pieces append only in order, retries are recognised and damaged pieces are refused", async () => {
  const { store, dir } = setup();
  const content = randomBytes(UPLOAD_CHUNK_BYTES + 1000);
  const session = store.create("w1", upload(content.length));
  const first = content.subarray(0, UPLOAD_CHUNK_BYTES),
    rest = content.subarray(UPLOAD_CHUNK_BYTES);
  // Out of order: the server reports where to continue.
  await assert.rejects(
    store.append(session.id, "w1", UPLOAD_CHUNK_BYTES, rest, sha(rest)),
    (error) => error instanceof UploadOffsetConflict && error.received === 0,
  );
  // Damaged in transit.
  await assert.rejects(
    store.append(session.id, "w1", 0, first, sha(rest)),
    /damaged/,
  );
  // Another studio cannot touch it.
  await assert.rejects(
    store.append(session.id, "w2", 0, first, sha(first)),
    UploadSessionGone,
  );
  assert.equal(
    (await store.append(session.id, "w1", 0, first, sha(first))).received,
    UPLOAD_CHUNK_BYTES,
  );
  // A retried piece that already arrived is acknowledged, not appended.
  assert.equal(
    (await store.append(session.id, "w1", 0, first, sha(first))).received,
    UPLOAD_CHUNK_BYTES,
  );
  const done = await store.append(
    session.id,
    "w1",
    UPLOAD_CHUNK_BYTES,
    rest,
    sha(rest),
  );
  assert.equal(done.state, "complete");
  assert.equal(done.sha256, sha(content));
  assert.deepEqual(
    await readFile(path.join(dir, "upload-staging", `${session.id}.part`)),
    content,
  );
  // A finished upload is queued for the destination it was started for.
  assert.throws(
    () => store.complete(session.id, "w1", "upload", "project-2"),
    /different destination/,
  );
  assert.equal(
    store.complete(session.id, "w1", "upload", "project-1").bytes,
    content.length,
  );
});

test("a piece written before a crash is overwritten from the recorded position", async () => {
  const { store, dir } = setup();
  const content = randomBytes(4096);
  const session = store.create("w1", upload(content.length));
  // Bytes on disk the database never recorded (crash after write).
  await writeFile(
    path.join(dir, "upload-staging", `${session.id}.part`),
    randomBytes(3000),
  );
  const done = await store.append(session.id, "w1", 0, content, sha(content));
  assert.equal(done.sha256, sha(content));
  assert.deepEqual(
    await readFile(path.join(dir, "upload-staging", `${session.id}.part`)),
    content,
  );
});

test("type limits, studio slots and the shared staging pool bound new uploads", () => {
  const { store } = setup({
    REELCHEMY_MEDIA_RAW_BYTES: String(512 * 1024 ** 2),
  });
  assert.throws(() =>
    store.create("w1", upload(MAX_MEDIA_UPLOAD_BYTES.image + 1, "image")),
  );
  assert.throws(() =>
    store.create("w1", upload(MAX_MEDIA_UPLOAD_BYTES.video + 1)),
  );
  store.create("w1", upload(100 * 1024 ** 2));
  store.create("w1", upload(100 * 1024 ** 2));
  assert.throws(
    () => store.create("w1", upload(1024)),
    (error) => (error as { scope?: string }).scope === "studio",
  );
  assert.throws(
    () => store.create("w2", upload(400 * 1024 ** 2)),
    (error) => (error as { scope?: string }).scope === "global",
  );
  store.create("w2", upload(300 * 1024 ** 2));
});

test("idle uploads and orphaned pieces are removed; a finished upload moves into the queue once", async () => {
  const { store, dir, db, advance } = setup();
  const idle = store.create("w1", upload(10));
  advance(7 * 3600000);
  // Young unowned files are left alone; old ones are removed.
  const orphan = path.join(dir, "upload-staging", `${randomUUID()}.part`);
  await writeFile(orphan, "x");
  store.cleanup();
  assert.equal(store.status(idle.id, "w1"), undefined);
  assert.deepEqual((await readdir(path.join(dir, "upload-staging"))).sort(), [
    path.basename(orphan),
  ]);
  await utimes(orphan, new Date(0), new Date(0));
  store.cleanup();
  assert.deepEqual(await readdir(path.join(dir, "upload-staging")), []);

  const content = randomBytes(2048);
  const session = store.create("w1", upload(content.length));
  await store.append(session.id, "w1", 0, content, sha(content));
  const requestId = randomUUID();
  store.adopt(session.id, "w1", requestId);
  const inputs = new MediaInputFiles(dir);
  assert.deepEqual(
    inputs.read(requestId, content.length, content.length, sha(content)),
    content,
  );
  const source = await inputs.verifiedPath(
    requestId,
    content.length,
    content.length,
    sha(content),
  );
  assert.deepEqual(await readFile(source.file), content);
  await assert.rejects(
    inputs.verifiedPath(
      requestId,
      content.length,
      content.length,
      sha(Buffer.from("other")),
    ),
  );
  assert.throws(
    () => store.adopt(session.id, "w1", randomUUID()),
    UploadSessionGone,
  );
  // Deleting a studio forgets its uploads.
  const kept = store.create("w3", upload(10));
  db.prepare("INSERT INTO workspaces(id) VALUES ('w3')").run();
  db.prepare("DELETE FROM workspaces WHERE id='w3'").run();
  assert.equal(store.status(kept.id, "w3"), undefined);
});
