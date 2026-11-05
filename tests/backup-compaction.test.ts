import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { createBackup, verifyBackup, restoreBackup } from "../src/lib/backup";
import { initializePrivacyVault } from "../src/lib/privacy-vault";

test("new backup and restore copies compact obsolete private payload without changing originals or previous snapshots", async () => {
  const root = await mkdtemp(
    path.join(tmpdir(), "reelchemy-backup-private-pages-"),
  );
  const data = path.join(root, "data"),
    artifacts = path.join(root, "artifacts"),
    vault = initializePrivacyVault(path.join(root, "privacy"));
  try {
    await mkdir(data, { mode: 0o700 });
    await mkdir(artifacts, { mode: 0o700 });
    const file = path.join(data, "studio.sqlite"),
      db = new Database(file);
    const canary = "REMOVED_PRIVATE_SNAPSHOT_PAYLOAD_739ac";
    try {
      db.pragma("secure_delete=OFF");
      db.exec(
        "CREATE TABLE projects(id TEXT PRIMARY KEY,data TEXT);CREATE TABLE workspaces(owner_id TEXT);CREATE TABLE jobs(id TEXT PRIMARY KEY,project_id TEXT,status TEXT,data TEXT);CREATE TABLE removed(data TEXT)",
      );
      db.prepare("INSERT INTO removed VALUES(?)").run(canary.repeat(2048));
      db.exec("DELETE FROM removed");
    } finally {
      db.close();
    }
    const before = await readFile(file);
    assert(before.includes(Buffer.from(canary)));
    const output = path.join(root, "snapshot");
    await createBackup({ data, artifacts, output, vault });
    await verifyBackup(output);
    const backupBytes = await readFile(path.join(output, "data/studio.sqlite"));
    assert(!backupBytes.includes(Buffer.from(canary)));
    assert.deepEqual(await readFile(file), before);
    const restored = await restoreBackup(output, path.join(root, "restored"), {
      vault,
    });
    assert(
      !(await readFile(path.join(restored.data, "studio.sqlite"))).includes(
        Buffer.from(canary),
      ),
    );
    assert.deepEqual(
      await readFile(path.join(output, "data/studio.sqlite")),
      backupBytes,
    );
    assert.deepEqual(await readFile(file), before);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
