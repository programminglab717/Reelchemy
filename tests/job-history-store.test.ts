import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { migrateMediaReferences } from "../src/lib/media-references";
import {
  migrateJobHistoryStorage,
  reserveJobHistory,
  jobHistoryUsage,
  assertJobHistoryComplete,
} from "../src/lib/job-history-store";
import {
  jobHistoryPolicy,
  jobDocumentReservationBytes,
  maximumJobDocumentBytes,
  JobHistoryLimit,
  JobHistoryUnavailable,
} from "../src/lib/job-history-policy";
const slot = jobDocumentReservationBytes,
  policy = {
    ...jobHistoryPolicy({}),
    studioBytes: 2 * slot,
    serviceBytes: 3 * slot,
    studioJobs: 10,
    serviceJobs: 20,
  };
function fixture(
  run: (f: {
    db: Database.Database;
    make: (owner?: string) => { jobId: string; projectId: string };
  }) => void,
) {
  const db = new Database(":memory:");
  db.exec(
    "CREATE TABLE projects(id TEXT PRIMARY KEY,data TEXT,workspace_id TEXT,trashed_at TEXT);CREATE TABLE jobs(id TEXT PRIMARY KEY,project_id TEXT,status TEXT,data TEXT,timeline TEXT);CREATE TABLE project_deletions(project_id TEXT);CREATE TABLE render_job_attempts(job_id TEXT PRIMARY KEY,started_at TEXT)",
  );
  migrateMediaReferences(db);
  migrateJobHistoryStorage(db);
  migrateJobHistoryStorage(db);
  const make = (owner = "owner") =>
    db
      .transaction(() => {
        const projectId = randomUUID(),
          jobId = randomUUID();
        db.prepare("INSERT INTO projects VALUES(?,'{}',?,NULL)").run(
          projectId,
          owner,
        );
        reserveJobHistory(db, jobId, projectId, owner, policy);
        db.prepare("INSERT INTO jobs VALUES(?,?,'queued','{}','{}')").run(
          jobId,
          projectId,
        );
        return { jobId, projectId };
      })
      .immediate();
  try {
    run({ db, make });
  } finally {
    db.close();
  }
}
test("job report capacity is captured before insertion, isolates owners and shared space and rolls back whole refused transactions", () =>
  fixture(({ db, make }) => {
    make();
    make();
    const own = jobHistoryUsage(db, "owner", policy);
    assert.equal(own.bytes + own.reservedBytes, 2 * slot);
    assert.equal(own.fullJobs, 2);
    assert.throws(
      () => make(),
      (error: unknown) =>
        error instanceof JobHistoryLimit && error.scope === "studio",
    );
    make("other");
    assert.throws(
      () => make("third"),
      (error: unknown) =>
        error instanceof JobHistoryLimit && error.scope === "service",
    );
    assert.equal(
      (db.prepare("SELECT count(*) AS n FROM jobs").get() as { n: number }).n,
      3,
    );
    assert.equal(
      (db.prepare("SELECT count(*) AS n FROM projects").get() as { n: number })
        .n,
      3,
    );
    assert.throws(
      () => reserveJobHistory(db, randomUUID(), randomUUID(), "owner", policy),
      JobHistoryUnavailable,
    );
    const p = randomUUID();
    db.prepare("INSERT INTO projects VALUES(?,'{}','owner',NULL)").run(p);
    assert.throws(
      () =>
        db
          .prepare("INSERT INTO jobs VALUES(?,?,'queued','{}','{}')")
          .run(randomUUID(), p),
      /reservation/,
    );
  }));
test("immutable timeline, UTF-8 report and bounded request receipts replace their hold only after a terminal native attempt ends", () =>
  fixture(({ db, make }) => {
    const { jobId, projectId } = make(),
      timeline = JSON.stringify({ caption: "café → publish" }),
      data = JSON.stringify({ id: jobId, report: "世界" });
    db.prepare("INSERT INTO render_job_attempts VALUES(?,'fixture')").run(
      jobId,
    );
    db.prepare(
      "UPDATE jobs SET status='rendering',data=?,timeline=? WHERE id=?",
    ).run(data, timeline, jobId);
    db.prepare("INSERT INTO export_requests VALUES(?,?,?,?)").run(
      projectId,
      "once",
      jobId,
      "version",
    );
    const expected =
      Buffer.byteLength(data) +
      Buffer.byteLength(timeline) +
      Buffer.byteLength(projectId) +
      4 +
      Buffer.byteLength(jobId) +
      7;
    let usage = jobHistoryUsage(db, "owner", policy);
    assert.equal(usage.bytes, expected);
    assert.equal(usage.bytes + usage.reservedBytes, slot);
    db.prepare("UPDATE jobs SET status='completed' WHERE id=?").run(jobId);
    assert(jobHistoryUsage(db, "owner", policy).reservedBytes > 0);
    db.prepare("DELETE FROM render_job_attempts WHERE job_id=?").run(jobId);
    usage = jobHistoryUsage(db, "owner", policy);
    assert.equal(usage.reservedBytes, 0);
    assert.equal(usage.bytes, expected);
    assert.throws(
      () =>
        db
          .prepare("INSERT INTO export_requests VALUES(?,?,?,?)")
          .run(projectId, "x".repeat(4096), jobId, "version"),
      /receipt/,
    );
    assert.throws(
      () =>
        db.prepare("UPDATE export_requests SET request_version='other'").run(),
      /cannot change/,
    );
    db.prepare("DELETE FROM jobs WHERE id=?").run(jobId);
    assert.equal(jobHistoryUsage(db, "owner", policy).bytes, 0);
  }));
test("oversized report growth cannot bypass the document ceiling or silently repair a missing index row", () =>
  fixture(({ db, make }) => {
    const { jobId } = make();
    assert.throws(
      () =>
        db
          .prepare("UPDATE jobs SET data=? WHERE id=?")
          .run("x".repeat(maximumJobDocumentBytes + 1), jobId),
      /captured document bound/,
    );
    assert.equal(
      (
        db.prepare("SELECT data FROM jobs WHERE id=?").get(jobId) as {
          data: string;
        }
      ).data,
      "{}",
    );
    db.prepare("DELETE FROM job_history_sizes WHERE job_id=?").run(jobId);
    assert.throws(() => assertJobHistoryComplete(db), JobHistoryUnavailable);
    assert.throws(() => migrateJobHistoryStorage(db), JobHistoryUnavailable);
    assert.equal(
      db.prepare("SELECT 1 FROM job_history_sizes WHERE job_id=?").get(jobId),
      undefined,
    );
  }));
