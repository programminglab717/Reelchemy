import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { randomUUID, createHash } from "node:crypto";
import {
  migrateMediaReferences,
  rebuildMediaReferences,
} from "../src/lib/media-references";
import { migrateExportFileRemovals } from "../src/lib/export-file-store";
import {
  migrateExportStorage,
  reserveExportStorage,
} from "../src/lib/export-storage-store";
import { exportStoragePolicy } from "../src/lib/export-storage-policy";
import {
  migrateJobHistoryStorage,
  reserveJobHistory,
  verifyJobHistoryAccounting,
} from "../src/lib/job-history-store";
import {
  jobHistoryPolicy,
  jobDocumentReservationBytes,
} from "../src/lib/job-history-policy";
import {
  previewJobHistoryRetirement,
  applyJobHistoryRetirement,
} from "../src/lib/job-history-retention";
import { readRetiredJob } from "../src/lib/job-history-references";
import { createBackup, verifyBackup, restoreBackup } from "../src/lib/backup";
const hash = (bytes: Buffer) =>
  createHash("sha256").update(bytes).digest("hex");
test("v4 snapshots preserve retired job-only originals and replay records, normalize only copied holds and refuse a rehashed phantom metadata reservation", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "reelchemy-history-backup-")),
    data = path.join(root, "source/data"),
    artifacts = path.join(root, "source/exports"),
    output = path.join(root, "snapshot"),
    file = path.join(data, "studio.sqlite"),
    projectId = randomUUID(),
    source = randomUUID();
  try {
    await mkdir(path.join(data, "assets"), { recursive: true });
    await mkdir(artifacts, { recursive: true });
    await writeFile(
      path.join(data, "assets", source),
      "OWNED JOB-ONLY ORIGINAL",
    );
    const db = new Database(file);
    db.exec(
      "CREATE TABLE projects(id TEXT PRIMARY KEY,data TEXT,workspace_id TEXT,trashed_at TEXT);CREATE TABLE jobs(id TEXT PRIMARY KEY,project_id TEXT,status TEXT,data TEXT,timeline TEXT);CREATE TABLE workspaces(owner_id TEXT);CREATE TABLE project_deletions(project_id TEXT,state TEXT)",
    );
    db.prepare("INSERT INTO projects VALUES(?,?,'owner',NULL)").run(
      projectId,
      JSON.stringify({ private: "KEEP_FILM", assets: [] }),
    );
    migrateMediaReferences(db);
    migrateExportFileRemovals(db);
    migrateExportStorage(db);
    migrateJobHistoryStorage(db);
    const policy = jobHistoryPolicy({}),
      make = (timeline: string) =>
        db
          .transaction(() => {
            const id = randomUUID();
            reserveJobHistory(db, id, projectId, "owner", policy);
            db.prepare("INSERT INTO jobs VALUES(?,?,'queued',?,?)").run(
              id,
              projectId,
              JSON.stringify({
                id,
                projectId,
                status: "queued",
                issues: [],
                report: null,
              }),
              timeline,
            );
            reserveExportStorage(
              db,
              id,
              projectId,
              "owner",
              exportStoragePolicy({}),
            );
            db.prepare("INSERT INTO export_requests VALUES(?,?,?,'saved')").run(
              projectId,
              id,
              id,
            );
            return id;
          })
          .immediate();
    const retired = make(JSON.stringify({ assetId: source }));
    db.prepare("UPDATE jobs SET status='failed',data=? WHERE id=?").run(
      JSON.stringify({
        id: retired,
        projectId,
        status: "failed",
        issues: [],
        report: { detail: "RETIRE_" + "x".repeat(32768) },
      }),
      retired,
    );
    const preview = previewJobHistoryRetirement(
        db,
        retired,
        "owner",
        policy,
      )!.preview!,
      receipt = applyJobHistoryRetirement(
        db,
        retired,
        "owner",
        preview.digest,
        policy,
      )!;
    const queued = make("{}"),
      sourceRows = db
        .prepare("SELECT * FROM job_history_sizes ORDER BY job_id")
        .all();
    db.close();
    const original = await readFile(file),
      sourceBytes = await readFile(path.join(data, "assets", source));
    await createBackup({ data, artifacts, output });
    const manifest = await verifyBackup(output);
    assert.equal(manifest.version, 4);
    assert.deepEqual(manifest.capabilities, [
      "export-storage-v1",
      "job-history-v1",
    ]);
    assert.equal(hash(await readFile(file)), hash(original));
    assert.equal(
      hash(await readFile(path.join(data, "assets", source))),
      hash(sourceBytes),
    );
    let copy = new Database(path.join(output, "data/studio.sqlite"));
    verifyJobHistoryAccounting(copy);
    assert.deepEqual(readRetiredJob(copy, retired)?.sourceIds, [source]);
    assert.equal(readRetiredJob(copy, retired)?.digest, receipt.digest);
    assert.equal(
      (
        copy.prepare("SELECT status FROM jobs WHERE id=?").get(queued) as {
          status: string;
        }
      ).status,
      "failed",
    );
    copy.close();
    const restored = path.join(root, "restored");
    await restoreBackup(output, restored);
    copy = new Database(path.join(restored, "data/studio.sqlite"));
    rebuildMediaReferences(copy);
    verifyJobHistoryAccounting(copy);
    assert(
      copy
        .prepare("SELECT 1 FROM job_media_refs WHERE job_id=? AND asset_id=?")
        .get(retired, source),
    );
    assert.equal(readRetiredJob(copy, retired)?.digest, receipt.digest);
    copy.close();
    assert.equal(
      hash(await readFile(path.join(restored, "data/assets", source))),
      hash(sourceBytes),
    );
    const live = new Database(file, { readonly: true });
    assert.deepEqual(
      live.prepare("SELECT * FROM job_history_sizes ORDER BY job_id").all(),
      sourceRows,
    );
    assert.equal(
      (
        live.prepare("SELECT status FROM jobs WHERE id=?").get(queued) as {
          status: string;
        }
      ).status,
      "queued",
    );
    assert.equal(
      (
        live
          .prepare(
            "SELECT reservation_bytes FROM job_history_sizes WHERE job_id=?",
          )
          .get(queued) as { reservation_bytes: number }
      ).reservation_bytes,
      jobDocumentReservationBytes,
    );
    live.close();
    const manifestPath = path.join(output, "manifest.json"),
      savedManifest = await readFile(manifestPath);
    await writeFile(
      manifestPath,
      JSON.stringify({ ...manifest, capabilities: ["export-storage-v1"] }),
    );
    await assert.rejects(verifyBackup(output), /capability/);
    await writeFile(manifestPath, savedManifest);
    const snapshotFile = path.join(output, "data/studio.sqlite"),
      snapshot = await readFile(snapshotFile),
      forged = new Database(snapshotFile);
    forged
      .prepare(
        "UPDATE job_history_sizes SET reservation_bytes=1 WHERE job_id=?",
      )
      .run(retired);
    forged.close();
    const changed = await readFile(snapshotFile),
      entry = manifest.entries.find(
        (value) => value.path === "data/studio.sqlite",
      )!;
    entry.bytes = changed.length;
    entry.sha256 = hash(changed);
    await writeFile(manifestPath, JSON.stringify(manifest));
    await assert.rejects(verifyBackup(output));
    await writeFile(snapshotFile, snapshot);
    await writeFile(manifestPath, savedManifest);
    await verifyBackup(output);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
