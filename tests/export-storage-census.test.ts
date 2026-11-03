import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  rm,
  unlink,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { collectExportCensus } from "../src/lib/export-storage-census";
import {
  ExportStorageUnavailable,
  exportStoragePolicy,
} from "../src/lib/export-storage-policy";
import {
  migrateExportStorage,
  publishExportCensus,
  exportStorageUsage,
} from "../src/lib/export-storage-store";
async function fixture(
  run: (f: {
    db: Database.Database;
    root: string;
    jobId: string;
    projectId: string;
    dir: string;
  }) => Promise<void>,
) {
  const root = await mkdtemp(path.join(tmpdir(), "reelchemy-export-census-")),
    db = new Database(":memory:"),
    jobId = randomUUID(),
    projectId = randomUUID(),
    dir = path.join(root, jobId);
  db.exec(
    "CREATE TABLE projects(id TEXT PRIMARY KEY,workspace_id TEXT,trashed_at TEXT);CREATE TABLE jobs(id TEXT PRIMARY KEY,project_id TEXT,status TEXT);CREATE TABLE project_deletions(project_id TEXT);CREATE TABLE render_job_attempts(job_id TEXT PRIMARY KEY,started_at TEXT);CREATE TABLE export_file_removals(job_id TEXT,state TEXT)",
  );
  db.prepare("INSERT INTO projects VALUES(?,'owner',NULL)").run(projectId);
  db.prepare("INSERT INTO jobs VALUES(?,?,'completed')").run(jobId, projectId);
  migrateExportStorage(db);
  await mkdir(dir);
  await writeFile(path.join(dir, "video.mp4"), "KEEP");
  try {
    await run({ db, root, jobId, projectId, dir });
  } finally {
    db.close();
    await rm(root, { recursive: true, force: true });
  }
}
test("read-only census collects exact owned output without changing projects/jobs and publishes only through the explicit writer step", async () =>
  fixture(async (f) => {
    const before = JSON.stringify(f.db.prepare("SELECT * FROM jobs").all()),
      policy = exportStoragePolicy({});
    assert.throws(
      () => exportStorageUsage(f.db, "owner", policy),
      ExportStorageUnavailable,
    );
    const rows = await collectExportCensus(f.db, f.root);
    assert.deepEqual(rows, [
      {
        jobId: f.jobId,
        projectId: f.projectId,
        workspaceId: "owner",
        status: "completed",
        bytes: 4,
        files: 1,
      },
    ]);
    assert.equal(
      JSON.stringify(f.db.prepare("SELECT * FROM jobs").all()),
      before,
    );
    assert.throws(
      () => exportStorageUsage(f.db, "owner", policy),
      ExportStorageUnavailable,
    );
    publishExportCensus(f.db, rows, policy);
    assert.equal(exportStorageUsage(f.db, "owner", policy).usedBytes, 4);
    assert.equal(await readFile(path.join(f.dir, "video.mp4"), "utf8"), "KEEP");
  }));
test("a changed job context after the scan cannot publish a stale census and abort has no write effect", async () =>
  fixture(async (f) => {
    const rows = await collectExportCensus(f.db, f.root);
    f.db.prepare("UPDATE jobs SET status='failed' WHERE id=?").run(f.jobId);
    assert.throws(
      () => publishExportCensus(f.db, rows, exportStoragePolicy({})),
      ExportStorageUnavailable,
    );
    await assert.rejects(
      collectExportCensus(f.db, f.root, AbortSignal.abort()),
      ExportStorageUnavailable,
    );
    assert.equal(
      (
        f.db
          .prepare("SELECT count(*) AS n FROM export_storage_entries")
          .get() as { n: number }
      ).n,
      0,
    );
  }));
test("payload reappearing after a completed removal is an operator refusal, never an empty or resurrected export", async () =>
  fixture(async (f) => {
    f.db
      .prepare("INSERT INTO export_file_removals VALUES(?,'completed')")
      .run(f.jobId);
    await assert.rejects(
      collectExportCensus(f.db, f.root),
      ExportStorageUnavailable,
    );
    assert.equal(await readFile(path.join(f.dir, "video.mp4"), "utf8"), "KEEP");
    f.db.prepare("UPDATE export_file_removals SET state='queued'").run();
    const [pending] = await collectExportCensus(f.db, f.root);
    assert.equal(pending.bytes, 4);
  }));

test("completed outputs missing their MP4 cannot be recounted as zero or adopted from a wrong artifact root", async () =>
  fixture(async (f) => {
    await assert.rejects(
      collectExportCensus(f.db, path.join(f.root, "wrong-root")),
      ExportStorageUnavailable,
    );
    await unlink(path.join(f.dir, "video.mp4"));
    await writeFile(path.join(f.dir, "report.json"), "report");
    await assert.rejects(
      collectExportCensus(f.db, f.root),
      ExportStorageUnavailable,
    );
    f.db
      .prepare("INSERT INTO export_file_removals VALUES(?,'queued')")
      .run(f.jobId);
    const [pending] = await collectExportCensus(f.db, f.root);
    assert.equal(pending.bytes, 6);
  }));
