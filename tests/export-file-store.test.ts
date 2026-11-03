import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import * as store from "../src/lib/export-file-store";
import {
  ExportFileBusy,
  ExportFileCapacity,
  ExportFileUnavailable,
  type ExportFileManifest,
} from "../src/lib/export-file-policy";
function fixture(
  run: (
    db: Database.Database,
    make: (workspace?: string) => ExportFileManifest,
  ) => void,
) {
  const db = new Database(":memory:");
  db.exec(
    "CREATE TABLE projects(id TEXT PRIMARY KEY,workspace_id TEXT,trashed_at TEXT);CREATE TABLE jobs(id TEXT PRIMARY KEY,project_id TEXT,status TEXT);CREATE TABLE project_deletions(project_id TEXT)",
  );
  store.migrateExportFileRemovals(db);
  store.migrateExportFileRemovals(db);
  function make(workspace = "owner"): ExportFileManifest {
    const projectId = randomUUID(),
      jobId = randomUUID();
    db.prepare("INSERT INTO projects VALUES(?,?,NULL)").run(
      projectId,
      workspace,
    );
    db.prepare("INSERT INTO jobs VALUES(?,?,'completed')").run(
      jobId,
      projectId,
    );
    return {
      format: "reelchemy-export-files-v1",
      jobId,
      projectId,
      workspaceId: workspace,
      root: null,
      directory: null,
      files: [],
    };
  }
  try {
    run(db, make);
  } finally {
    db.close();
  }
}
test("owner, terminal attempt and Trash guards prevent moves/restarts after consent", () =>
  fixture((db, make) => {
    const m = make();
    assert.equal(
      store.requestExportFileRemoval(db, { ...m, workspaceId: "foreign" }),
      undefined,
    );
    db.prepare("INSERT INTO render_job_attempts VALUES(?,'now')").run(m.jobId);
    assert.throws(() => store.requestExportFileRemoval(db, m), ExportFileBusy);
    db.exec(
      "DELETE FROM render_job_attempts;UPDATE projects SET trashed_at='now'",
    );
    assert.equal(store.requestExportFileRemoval(db, m), undefined);
    db.exec("UPDATE projects SET trashed_at=NULL");
    assert.equal(store.requestExportFileRemoval(db, m)?.state, "queued");
    assert.throws(
      () =>
        db
          .prepare("UPDATE projects SET workspace_id='foreign' WHERE id=?")
          .run(m.projectId),
      /ownership/,
    );
    assert.throws(
      () =>
        db
          .prepare("UPDATE jobs SET project_id='other' WHERE id=?")
          .run(m.jobId),
      /move/,
    );
    assert.throws(
      () =>
        db.prepare("UPDATE jobs SET status='queued' WHERE id=?").run(m.jobId),
      /regenerated/,
    );
    assert.throws(
      () =>
        db
          .prepare("INSERT INTO render_job_attempts VALUES(?,'now')")
          .run(m.jobId),
      /owns/,
    );
    assert.equal(store.getExportFileRemoval(db, m.jobId, "foreign"), undefined);
  }));
test("receipts replay at capacity and retry/recovery obey token CAS", () =>
  fixture((db, make) => {
    const m = make(),
      first = store.requestExportFileRemoval(db, m, 1000)!;
    for (let i = 0; i < 4; i++)
      store.requestExportFileRemoval(db, make(), 2000 + i);
    assert.throws(
      () => store.requestExportFileRemoval(db, make()),
      ExportFileCapacity,
    );
    assert.deepEqual(store.requestExportFileRemoval(db, m), first);
    const task = store.claimExportFileRemoval(db, 3000)!;
    assert.equal(task.jobId, m.jobId);
    assert.throws(
      () => store.finishExportFileRemoval(db, { ...task, token: randomUUID() }),
      ExportFileUnavailable,
    );
    store.failExportFileRemoval(db, task, 3000);
    assert.equal(store.getExportFileRemoval(db, m.jobId)?.state, "failed");
    store.requestExportFileRemoval(db, m, 4000);
    const again = store.claimExportFileRemoval(db, 5000)!;
    assert.equal(again.jobId, m.jobId);
    store.recoverExportFileRemovals(db);
    assert.throws(
      () => store.finishExportFileRemoval(db, again),
      ExportFileUnavailable,
    );
    const recovered = store.claimExportFileRemoval(db, 6000)!;
    store.finishExportFileRemoval(db, recovered, 6001);
    assert.equal(store.getExportFileRemoval(db, m.jobId)?.state, "completed");
    assert.equal(
      (
        db
          .prepare("SELECT manifest FROM export_file_removals WHERE job_id=?")
          .get(m.jobId) as { manifest: null }
      ).manifest,
      null,
    );
    db.prepare("DELETE FROM jobs WHERE id=?").run(m.jobId);
    assert.equal(store.getExportFileRemoval(db, m.jobId), undefined);
  }));
test("corrupt context fails closed and review leases are scoped, bounded and expiring", () =>
  fixture((db, make) => {
    const m = make();
    store.requestExportFileRemoval(db, m);
    db.prepare("UPDATE export_file_removals SET manifest=?").run(
      JSON.stringify({ ...m, workspaceId: "foreign" }),
    );
    assert.equal(store.claimExportFileRemoval(db), undefined);
    assert.equal(store.getExportFileRemoval(db, m.jobId)?.state, "failed");
    assert.equal(store.claimExportFileRemoval(db), undefined);
    const token = store.acquireExportFileReview(db, "one", 1000);
    assert.throws(
      () => store.acquireExportFileReview(db, "one", 1001),
      ExportFileCapacity,
    );
    store.acquireExportFileReview(db, "two", 1001);
    assert.throws(
      () => store.acquireExportFileReview(db, "three", 1002),
      ExportFileCapacity,
    );
    store.releaseExportFileReview(db, "wrong");
    assert.throws(
      () => store.acquireExportFileReview(db, "three", 1002),
      ExportFileCapacity,
    );
    store.releaseExportFileReview(db, token);
    store.acquireExportFileReview(db, "three", 1002);
    assert.doesNotThrow(() => store.acquireExportFileReview(db, "one", 31002));
  }));
test("shared admission caps pending requests without exposing other studio totals and receipts still replay", () =>
  fixture((db, make) => {
    let first: ExportFileManifest | undefined;
    for (let i = 0; i < 50; i++) {
      const m = make(`studio-${Math.floor(i / 5)}`);
      first ??= m;
      store.requestExportFileRemoval(db, m);
    }
    assert.throws(
      () => store.requestExportFileRemoval(db, make("another-studio")),
      (e: unknown) =>
        e instanceof ExportFileCapacity &&
        e.scope === "service" &&
        !/50|studio-/.test(e.message),
    );
    assert.equal(
      store.requestExportFileRemoval(db, first!)?.jobId,
      first!.jobId,
    );
  }));
