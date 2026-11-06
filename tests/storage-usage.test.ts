import { test, after } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  readdir,
  symlink,
  stat,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { randomUUID, createHash } from "node:crypto";
import Database from "better-sqlite3";
import type { Asset } from "../src/lib/schema";
const root = await mkdtemp(path.join(tmpdir(), "reelchemy-storage-usage-")),
  data = path.join(root, "data");
Object.assign(process.env, {
  REELCHEMY_DATA_DIR: data,
  REELCHEMY_AUTH_DIR: path.join(root, "auth"),
  REELCHEMY_MEDIA_STORAGE_BYTES: String(4 * 1024 ** 2),
  REELCHEMY_MEDIA_SHARED_STORAGE_BYTES: String(8 * 1024 ** 2),
});
const app = await import("../src/lib/db"),
  inspect = new Database(path.join(data, "studio.sqlite"));
after(async () => {
  inspect.close();
  await rm(root, { recursive: true, force: true });
});
function run(directory: string, ...args: string[]) {
  return spawnSync(
    process.execPath,
    ["--import", "tsx", "scripts/storage-usage.ts", ...args],
    {
      env: {
        ...process.env,
        REELCHEMY_DATA_DIR: directory,
        AI_API_KEY: "SYNTHETIC_SECRET_MUST_NOT_APPEAR",
        SMTP_PASSWORD: "SYNTHETIC_MAIL_SECRET_MUST_NOT_APPEAR",
      },
      encoding: "utf8",
      timeout: 10000,
      maxBuffer: 65536,
    },
  );
}
const hash = async (file: string) =>
  createHash("sha256")
    .update(await readFile(file))
    .digest("hex");
test("the operator report reads a consistent service/studio snapshot, deduplicates retained media and never changes database/WAL data or prints content/credentials", async () => {
  const workspace = app.ensureWorkspace(
      "usage-private-owner",
      "Private owner",
    ).id,
    brief = {
      prompt: "PRIVATE_USAGE_CONTENT_CANARY",
      duration: 5,
      format: "landscape" as const,
    },
    p = app.createProject(brief, workspace),
    other = app.createProject(brief, workspace),
    id = randomUUID();
  await mkdir(path.join(data, "assets"), { recursive: true });
  await writeFile(path.join(data, "assets", id), Buffer.alloc(65536, 3));
  const asset: Asset = {
    id,
    name: "Private asset name",
    mime: "image/png",
    source: "Fixture",
    license: "Owned",
    createdAt: new Date().toISOString(),
  };
  app.appendOwnedAsset(p.id, workspace, asset);
  app.appendOwnedAsset(other.id, workspace, asset);
  app.mediaProcessing.reserve({
    workspaceId: workspace,
    projectId: p.id,
    operation: "upload",
    requestKey: randomUUID(),
  });
  const files = [
      path.join(data, "studio.sqlite"),
      path.join(data, "studio.sqlite-wal"),
    ],
    before = await Promise.all(files.map(hash));
  const service = run(data);
  assert.equal(service.status, 0, service.stderr);
  const report = JSON.parse(service.stdout);
  assert.equal(report.scope, "service");
  assert.equal(report.projects.count, 2);
  assert.equal(report.normalizedMedia.files, 1);
  assert.equal(report.normalizedMedia.bytes, 65536);
  assert.equal(report.mediaInputs.activeRequests, 1);
  assert.equal(report.mediaInputs.reservedBytes, 96 * 1024 ** 2);
  const own = run(data, "--workspace", workspace);
  assert.equal(own.status, 0, own.stderr);
  const studio = JSON.parse(own.stdout);
  assert.equal(studio.scope, "studio");
  assert.equal(studio.workspaceId, workspace);
  assert.equal(studio.normalizedMedia.bytes, 65536);
  assert.equal(studio.normalizedMedia.limitBytes, 4 * 1024 ** 2);
  assert.equal(
    studio.projects.bytes,
    app.studioProjectDataUsage(workspace).bytes,
  );
  for (const marker of [
    brief.prompt,
    asset.name,
    "SYNTHETIC_SECRET_MUST_NOT_APPEAR",
    "SYNTHETIC_MAIL_SECRET_MUST_NOT_APPEAR",
  ])
    assert(
      !(service.stdout + service.stderr + own.stdout + own.stderr).includes(
        marker,
      ),
    );
  assert.deepEqual(await Promise.all(files.map(hash)), before);
  assert.equal(
    await stat(path.join(root, "auth")).then(
      () => true,
      () => false,
    ),
    false,
  );
});
test("missing, old or corrupt data is refused without initialization, migration, repair or private error echoes", async () => {
  const missing = path.join(root, "missing");
  assert.equal(run(missing).status, 1);
  assert.equal(
    await stat(missing).then(
      () => true,
      () => false,
    ),
    false,
  );
  const legacy = path.join(root, "legacy");
  await mkdir(legacy);
  const dbfile = path.join(legacy, "studio.sqlite"),
    old = new Database(dbfile);
  old.exec("CREATE TABLE untouched(value TEXT)");
  old.prepare("INSERT INTO untouched VALUES(?)").run("PRIVATE_LEGACY_CANARY");
  old.close();
  const before = await hash(dbfile);
  const result = run(legacy);
  assert.equal(result.status, 1);
  assert(!result.stderr.includes("PRIVATE_LEGACY_CANARY"));
  assert(!result.stderr.includes(legacy));
  assert.equal(await hash(dbfile), before);
  assert.deepEqual(await readdir(legacy), ["studio.sqlite"]);
  const corrupt = path.join(root, "corrupt");
  await mkdir(corrupt);
  await writeFile(
    path.join(corrupt, "studio.sqlite"),
    "PRIVATE_CORRUPT_SOURCE_CANARY",
  );
  const failure = run(corrupt);
  assert.equal(failure.status, 1);
  assert(!failure.stderr.includes("PRIVATE_CORRUPT_SOURCE_CANARY"));
  assert.deepEqual(await readdir(corrupt), ["studio.sqlite"]);
});
test("symbolic database/root pointers and invalid arguments cannot read a target or create account/media state", async () => {
  const outside = path.join(root, "outside.sqlite");
  await writeFile(outside, "Preserve this external canary");
  const directory = path.join(root, "pointer");
  await mkdir(directory);
  await symlink(outside, path.join(directory, "studio.sqlite"));
  const before = await hash(outside);
  assert.equal(run(directory).status, 1);
  assert.equal(await hash(outside), before);
  assert.deepEqual(await readdir(directory), ["studio.sqlite"]);
  const linked = path.join(root, "linked-root");
  await symlink(data, linked);
  assert.equal(run(linked).status, 1);
  assert.equal(run(data, "--workspace", "../../private-auth").status, 1);
});
test("an incomplete derived census fails closed and is never silently repaired by a read-only report", () => {
  const id = (
    inspect
      .prepare("SELECT project_id FROM project_data_sizes LIMIT 1")
      .get() as { project_id: string }
  ).project_id;
  inspect.prepare("DELETE FROM project_data_sizes WHERE project_id=?").run(id);
  const result = run(data);
  assert.equal(result.status, 1);
  assert.equal(
    inspect
      .prepare("SELECT 1 FROM project_data_sizes WHERE project_id=?")
      .get(id),
    undefined,
  );
});
