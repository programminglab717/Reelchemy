import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import * as store from "../src/lib/export-storage-store";
import {
  exportStoragePolicy,
  ExportStorageLimit,
  ExportStorageUnavailable,
  type ExportStoragePolicy,
} from "../src/lib/export-storage-policy";
const MiB = 1024 ** 2,
  policy: ExportStoragePolicy = {
    ...exportStoragePolicy({}),
    reservationBytes: 4 * MiB,
    studioBytes: 8 * MiB,
    serviceBytes: 12 * MiB,
    studioExports: 10,
    serviceExports: 20,
  };
function fixture(
  run: (f: {
    db: Database.Database;
    make: (
      workspace?: string | null,
      status?: string,
    ) => { jobId: string; projectId: string; workspaceId: string | null };
    reserve: (
      workspace?: string | null,
      p?: ExportStoragePolicy,
    ) => { jobId: string; projectId: string; workspaceId: string | null };
  }) => void,
) {
  const db = new Database(":memory:");
  db.exec(
    "CREATE TABLE projects(id TEXT PRIMARY KEY,workspace_id TEXT,trashed_at TEXT);CREATE TABLE jobs(id TEXT PRIMARY KEY,project_id TEXT,status TEXT);CREATE TABLE project_deletions(project_id TEXT)",
  );
  store.migrateExportStorage(db);
  store.migrateExportStorage(db);
  const make = (workspace: string | null = "owner", status = "queued") => {
    const projectId = randomUUID(),
      jobId = randomUUID();
    db.prepare("INSERT INTO projects VALUES(?,?,NULL)").run(
      projectId,
      workspace,
    );
    db.prepare("INSERT INTO jobs VALUES(?,?,?)").run(jobId, projectId, status);
    return { jobId, projectId, workspaceId: workspace };
  };
  const reserve = (workspace: string | null = "owner", p = policy) =>
    db
      .transaction(() => {
        const job = make(workspace);
        store.reserveExportStorage(db, job.jobId, job.projectId, workspace, p);
        return job;
      })
      .immediate();
  try {
    run({ db, make, reserve });
  } finally {
    db.close();
  }
}
test("atomic reservations isolate studios, cap shared usage and roll back refused jobs without leaving unknown rows", () =>
  fixture(({ db, reserve }) => {
    const a = reserve(),
      b = reserve();
    assert.equal(
      store.exportStorageUsage(db, "owner", policy).reservedBytes,
      8 * MiB,
    );
    assert.equal(
      store.exportStorageUsage(db, "owner", policy).pendingExports,
      2,
    );
    assert.throws(
      () => reserve(),
      (e: unknown) =>
        e instanceof ExportStorageLimit &&
        e.scope === "studio" &&
        e.kind === "bytes",
    );
    reserve("other");
    assert.throws(
      () => reserve("third"),
      (e: unknown) => e instanceof ExportStorageLimit && e.scope === "service",
    );
    assert.equal(
      (db.prepare("SELECT count(*) AS n FROM jobs").get() as { n: number }).n,
      3,
    );
    assert.equal(
      store.exportStorageUsage(db, "owner", policy).reservedBytes,
      8 * MiB,
    );
    assert.equal(
      store.exportStorageUsage(db, "other", policy).reservedBytes,
      4 * MiB,
    );
    assert.equal(
      store.reserveExportStorage(db, a.jobId, a.projectId, "owner", {
        ...policy,
        reservationBytes: 8 * MiB,
      }),
      4 * MiB,
    );
    assert.equal(
      store.exportOutputCeiling(db, b.jobId, {
        ...policy,
        reservationBytes: MiB,
      }),
      MiB,
    );
  }));
test("retained bytes replace a held reservation without double-counting, and only terminal settlement can release it", () =>
  fixture(({ db, reserve }) => {
    const job = reserve();
    store.settleExportStorage(db, job.jobId, MiB, 2, false);
    let usage = store.exportStorageUsage(db, "owner", policy);
    assert.equal(usage.usedBytes, MiB);
    assert.equal(usage.reservedBytes, 3 * MiB);
    assert.equal(usage.pendingExports, 1);
    assert.equal(usage.retainedExports, 1);
    assert.throws(
      () => store.settleExportStorage(db, job.jobId, MiB, 2, true),
      ExportStorageUnavailable,
    );
    db.prepare("UPDATE jobs SET status='completed' WHERE id=?").run(job.jobId);
    store.settleExportStorage(db, job.jobId, 2 * MiB, 3, true);
    usage = store.exportStorageUsage(db, "owner", policy);
    assert.equal(usage.usedBytes, 2 * MiB);
    assert.equal(usage.reservedBytes, 0);
    assert.equal(usage.pendingExports, 0);
    assert.equal(usage.retainedExports, 1);
    const next = reserve();
    assert.throws(() => reserve(), ExportStorageLimit);
    store.settleExportStorage(db, job.jobId, 0, 0, true);
    usage = store.exportStorageUsage(db, "owner", policy);
    assert.equal(usage.usedBytes, 0);
    assert.equal(usage.retainedExports, 0);
    assert.equal(usage.reservedBytes, 4 * MiB);
    db.prepare("DELETE FROM jobs WHERE id=?").run(next.jobId);
    assert.equal(
      store.exportStorageUsage(db, "owner", policy).reservedBytes,
      0,
    );
  }));
test("zero-byte retained files still consume export count and shared errors contain no foreign usage", () =>
  fixture(({ db, reserve }) => {
    const limits = {
      ...policy,
      reservationBytes: MiB,
      studioExports: 1,
      serviceExports: 2,
    };
    for (const owner of ["one", "two"]) {
      const job = reserve(owner, limits);
      db.prepare("UPDATE jobs SET status='completed' WHERE id=?").run(
        job.jobId,
      );
      store.settleExportStorage(db, job.jobId, 0, 1, true);
    }
    assert.throws(
      () => reserve("one", limits),
      (e: unknown) =>
        e instanceof ExportStorageLimit &&
        e.scope === "studio" &&
        e.kind === "exports",
    );
    assert.throws(
      () => reserve("three", limits),
      (e: unknown) =>
        e instanceof ExportStorageLimit &&
        e.scope === "service" &&
        e.kind === "exports" &&
        !/one|two|\d/.test(e.message),
    );
  }));
test("unknown jobs and stale/foreign census context fail closed without modifying existing ledger state", () =>
  fixture(({ db, make, reserve }) => {
    const owned = reserve(),
      unknown = make("legacy", "completed");
    assert.throws(
      () => store.exportStorageUsage(db, "owner", policy),
      ExportStorageUnavailable,
    );
    const before = db
      .prepare("SELECT * FROM export_storage_entries ORDER BY job_id")
      .all();
    assert.throws(
      () =>
        store.publishExportCensus(
          db,
          [{ ...owned, status: "queued", bytes: 0, files: 0 }],
          policy,
        ),
      ExportStorageUnavailable,
    );
    assert.deepEqual(
      db.prepare("SELECT * FROM export_storage_entries ORDER BY job_id").all(),
      before,
    );
    const rows = [
      { ...owned, status: "queued", bytes: 0, files: 0 },
      { ...unknown, status: "completed", bytes: MiB, files: 1 },
    ];
    store.publishExportCensus(db, rows, policy);
    assert.equal(store.exportStorageUsage(db, "legacy", policy).usedBytes, MiB);
    const oldCeiling = store.exportOutputCeiling(db, owned.jobId, policy);
    store.publishExportCensus(db, rows, {
      ...policy,
      reservationBytes: 8 * MiB,
      studioBytes: 16 * MiB,
      serviceBytes: 24 * MiB,
    });
    assert.equal(
      store.exportOutputCeiling(db, owned.jobId, {
        ...policy,
        reservationBytes: 8 * MiB,
      }),
      oldCeiling,
    );
    assert.throws(
      () =>
        db
          .prepare("UPDATE jobs SET project_id=? WHERE id=?")
          .run(unknown.projectId, owned.jobId),
      /cannot move/,
    );
    db.prepare("UPDATE projects SET workspace_id='new-owner' WHERE id=?").run(
      unknown.projectId,
    );
    assert.equal(store.exportStorageUsage(db, "legacy", policy).usedBytes, 0);
    assert.equal(
      store.exportStorageUsage(db, "new-owner", policy).usedBytes,
      MiB,
    );
  }));
test("a legacy terminal overage stays readable and can shrink, but unbudgeted queues cannot silently acquire unaffordable reservations", () =>
  fixture(({ db, make }) => {
    const legacy = make("owner", "completed");
    db.prepare(
      "DELETE FROM schema_migrations WHERE id='export-storage-census-v1'",
    ).run();
    assert.throws(
      () => store.exportStorageUsage(db, "owner", policy),
      ExportStorageUnavailable,
    );
    store.publishExportCensus(
      db,
      [{ ...legacy, status: "completed", bytes: 16 * MiB, files: 4 }],
      policy,
    );
    assert.equal(
      store.exportStorageUsage(db, "owner", policy).availableBytes,
      0,
    );
    const queued = make();
    assert.throws(
      () =>
        store.publishExportCensus(
          db,
          [
            { ...legacy, status: "completed", bytes: 16 * MiB, files: 4 },
            { ...queued, status: "queued", bytes: 0, files: 0 },
          ],
          policy,
        ),
      ExportStorageLimit,
    );
    assert.throws(
      () => store.exportStorageUsage(db, "owner", policy),
      ExportStorageUnavailable,
    );
    db.prepare("DELETE FROM jobs WHERE id=?").run(queued.jobId);
    store.settleExportStorage(db, legacy.jobId, 0, 0, true);
    assert.equal(store.exportStorageUsage(db, "owner", policy).usedBytes, 0);
  }));
