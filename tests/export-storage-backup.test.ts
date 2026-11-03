import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  rm,
  lstat,
} from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { randomUUID, createHash } from "node:crypto";
import { createBackup, verifyBackup, restoreBackup } from "../src/lib/backup";
import {
  migrateExportFileRemovals,
  requestExportFileRemoval,
} from "../src/lib/export-file-store";
import {
  migrateExportStorage,
  publishExportCensus,
} from "../src/lib/export-storage-store";
import { exportStoragePolicy } from "../src/lib/export-storage-policy";
const hash = (b: Buffer) => createHash("sha256").update(b).digest("hex");
test("budget snapshots declare v3, retain output/source state, omit consented files and restore no phantom holds", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "reelchemy-budget-backup-")),
    data = path.join(root, "source/data"),
    artifacts = path.join(root, "source/artifacts"),
    output = path.join(root, "snapshot"),
    projectId = randomUUID(),
    kept = randomUUID(),
    removed = randomUUID(),
    queued = randomUUID();
  try {
    await mkdir(data, { recursive: true });
    for (const id of [kept, removed])
      await mkdir(path.join(artifacts, id), { recursive: true });
    await writeFile(path.join(artifacts, kept, "video.mp4"), "KEEP");
    await writeFile(path.join(artifacts, removed, "video.mp4"), "REMOVE");
    const file = path.join(data, "studio.sqlite"),
      db = new Database(file);
    db.exec(
      "CREATE TABLE projects(id TEXT PRIMARY KEY,data TEXT,workspace_id TEXT,trashed_at TEXT);CREATE TABLE jobs(id TEXT PRIMARY KEY,project_id TEXT,status TEXT,data TEXT,timeline TEXT);CREATE TABLE workspaces(owner_id TEXT);CREATE TABLE project_deletions(project_id TEXT,state TEXT)",
    );
    db.prepare("INSERT INTO projects VALUES(?,?,'studio',NULL)").run(
      projectId,
      JSON.stringify({ assets: [], private: "KEEP_PROJECT" }),
    );
    for (const id of [kept, removed, queued]) {
      const status = id === queued ? "queued" : "completed";
      db.prepare("INSERT INTO jobs VALUES(?,?,?,?,?)").run(
        id,
        projectId,
        status,
        JSON.stringify({
          id,
          projectId,
          status,
          report: id === kept ? { export: { path: "old/source/path" } } : null,
          private: "KEEP_JOB",
        }),
        "{}",
      );
    }
    migrateExportFileRemovals(db);
    migrateExportStorage(db);
    const policy = { ...exportStoragePolicy({}), reservationBytes: 1024 ** 2 };
    publishExportCensus(
      db,
      [
        {
          jobId: kept,
          projectId,
          workspaceId: "studio",
          status: "completed",
          bytes: 4,
          files: 1,
        },
        {
          jobId: removed,
          projectId,
          workspaceId: "studio",
          status: "completed",
          bytes: 6,
          files: 1,
        },
        {
          jobId: queued,
          projectId,
          workspaceId: "studio",
          status: "queued",
          bytes: 0,
          files: 0,
        },
      ],
      policy,
    );
    db.prepare("UPDATE export_storage_entries SET dirty=1 WHERE job_id=?").run(
      queued,
    );
    requestExportFileRemoval(db, {
      format: "reelchemy-export-files-v1",
      jobId: removed,
      projectId,
      workspaceId: "studio",
      root: null,
      directory: null,
      files: [],
    });
    const originalLedger = db
      .prepare("SELECT * FROM export_storage_entries ORDER BY job_id")
      .all();
    db.close();
    const before = hash(await readFile(file));
    await createBackup({ data, artifacts, output });
    const manifest = await verifyBackup(output);
    assert.equal(manifest.version, 3);
    assert.deepEqual(manifest.capabilities, [
      "removed-export-files-v1",
      "export-storage-v1",
    ]);
    assert(
      !manifest.entries.some((e) => e.path.startsWith(`artifacts/${removed}/`)),
    );
    assert.equal(hash(await readFile(file)), before);
    assert.equal(
      await readFile(path.join(artifacts, removed, "video.mp4"), "utf8"),
      "REMOVE",
    );
    let copy = new Database(path.join(output, "data/studio.sqlite"));
    assert.equal(
      (
        copy
          .prepare(
            "SELECT sum(reservation_bytes) AS n FROM export_storage_entries",
          )
          .get() as { n: number }
      ).n,
      0,
    );
    assert.equal(
      (
        copy
          .prepare("SELECT sum(dirty) AS n FROM export_storage_entries")
          .get() as { n: number }
      ).n,
      0,
    );
    assert.equal(
      (
        copy.prepare("SELECT status FROM jobs WHERE id=?").get(queued) as {
          status: string;
        }
      ).status,
      "failed",
    );
    assert.equal(
      (
        copy
          .prepare(
            "SELECT retained_bytes FROM export_storage_entries WHERE job_id=?",
          )
          .get(removed) as { retained_bytes: number }
      ).retained_bytes,
      0,
    );
    copy.close();
    const restored = await restoreBackup(output, path.join(root, "restored"));
    copy = new Database(path.join(restored.data, "studio.sqlite"));
    assert.equal(
      (
        copy
          .prepare(
            "SELECT sum(reservation_bytes) AS n FROM export_storage_entries",
          )
          .get() as { n: number }
      ).n,
      0,
    );
    assert.equal(
      (copy.prepare("SELECT count(*) AS n FROM jobs").get() as { n: number }).n,
      3,
    );
    assert.equal(
      JSON.parse(
        (
          copy.prepare("SELECT data FROM jobs WHERE id=?").get(kept) as {
            data: string;
          }
        ).data,
      ).report.export.path,
      path.join(restored.artifacts, kept, "video.mp4"),
    );
    copy.close();
    await assert.rejects(lstat(path.join(restored.artifacts, removed)), {
      code: "ENOENT",
    });
    assert.equal(
      await readFile(path.join(restored.artifacts, kept, "video.mp4"), "utf8"),
      "KEEP",
    );
    const original = new Database(file);
    assert.deepEqual(
      original
        .prepare("SELECT * FROM export_storage_entries ORDER BY job_id")
        .all(),
      originalLedger,
    );
    assert.equal(
      (
        original.prepare("SELECT status FROM jobs WHERE id=?").get(queued) as {
          status: string;
        }
      ).status,
      "queued",
    );
    original.close();
    assert.equal(hash(await readFile(file)), before);
    const manifestFile = path.join(output, "manifest.json"),
      saved = await readFile(manifestFile, "utf8");
    await writeFile(
      manifestFile,
      JSON.stringify({
        ...manifest,
        capabilities: ["removed-export-files-v1"],
      }),
    );
    await assert.rejects(verifyBackup(output), /capability/);
    await writeFile(manifestFile, saved);
    // Rehash a semantically invalid ledger to prove validation is more than a
    // checksum test. This mutates only this owned disposable backup copy.
    const studioFile = path.join(output, "data/studio.sqlite"),
      studioBytes = await readFile(studioFile);
    copy = new Database(studioFile);
    copy
      .prepare(
        "UPDATE export_storage_entries SET reservation_bytes=1048576 WHERE job_id=?",
      )
      .run(kept);
    copy.close();
    const tampered = await readFile(studioFile);
    await writeFile(
      manifestFile,
      JSON.stringify({
        ...manifest,
        entries: manifest.entries.map((e) =>
          e.path === "data/studio.sqlite"
            ? { ...e, bytes: tampered.length, sha256: hash(tampered) }
            : e,
        ),
      }),
    );
    await assert.rejects(verifyBackup(output), /operator review/);
    await writeFile(studioFile, studioBytes);
    await writeFile(manifestFile, saved);
    await verifyBackup(output);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
