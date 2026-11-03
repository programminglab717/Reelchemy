import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { randomUUID, randomBytes } from "node:crypto";
import {
  migrateMediaReferences,
  rebuildMediaReferences,
} from "../src/lib/media-references";
import { migrateExportFileRemovals } from "../src/lib/export-file-store";
import {
  migrateExportStorage,
  reserveExportStorage,
  settleExportStorage,
} from "../src/lib/export-storage-store";
import { exportStoragePolicy } from "../src/lib/export-storage-policy";
import {
  migrateJobHistoryStorage,
  reserveJobHistory,
  jobHistoryUsage,
} from "../src/lib/job-history-store";
import {
  previewJobHistoryRetirement,
  applyJobHistoryRetirement,
  downloadJobHistory,
} from "../src/lib/job-history-retention";
import {
  jobHistoryPolicy,
  JobHistoryConflict,
  JobHistoryLimit,
  JobHistoryBusy,
} from "../src/lib/job-history-policy";
import { ownedJobHistoryPage } from "../src/lib/job-history-page";
import { encodeExportCursor } from "../src/lib/export-history-cursor";
const policy = { ...jobHistoryPolicy({}), studioRetired: 1, serviceRetired: 2 };
function fixture(
  run: (f: {
    db: Database.Database;
    make: (owner?: string) => { id: string; projectId: string; source: string };
  }) => void,
) {
  const db = new Database(":memory:");
  db.exec(
    "CREATE TABLE projects(id TEXT PRIMARY KEY,data TEXT,workspace_id TEXT,trashed_at TEXT);CREATE TABLE jobs(id TEXT PRIMARY KEY,project_id TEXT,status TEXT,data TEXT,timeline TEXT);CREATE TABLE project_deletions(project_id TEXT)",
  );
  migrateMediaReferences(db);
  migrateExportFileRemovals(db);
  migrateExportStorage(db);
  migrateJobHistoryStorage(db);
  const make = (owner = "owner") =>
    db
      .transaction(() => {
        const id = randomUUID(),
          projectId = randomUUID(),
          source = randomUUID(),
          timeline = JSON.stringify({
            scenes: [{ layers: [{ assetId: source }] }],
          });
        db.prepare("INSERT INTO projects VALUES(?,?,?,NULL)").run(
          projectId,
          JSON.stringify({ private: "KEEP_SAVED_FILM" }),
          owner,
        );
        reserveJobHistory(db, id, projectId, owner, policy);
        db.prepare("INSERT INTO jobs VALUES(?,?,'queued',?,?)").run(
          id,
          projectId,
          JSON.stringify({ id, projectId, status: "queued" }),
          timeline,
        );
        reserveExportStorage(db, id, projectId, owner, exportStoragePolicy({}));
        db.prepare(
          "INSERT INTO export_requests VALUES(?,'same-intent',?,'saved-version')",
        ).run(projectId, id);
        db.prepare("UPDATE jobs SET status='failed',data=? WHERE id=?").run(
          JSON.stringify({
            id,
            projectId,
            status: "failed",
            createdAt: new Date().toISOString(),
            report: { private: "OLD_DETAIL_" + "x".repeat(65536) },
          }),
          id,
        );
        return { id, projectId, source };
      })
      .immediate();
  try {
    run({ db, make });
  } finally {
    db.close();
  }
}
test("reviewed activity retirement keeps source/owner/idempotency records, replays at capacity and frees only consented details without changing the film", () =>
  fixture(({ db, make }) => {
    const first = make(),
      other = make(),
      filmBefore = db
        .prepare("SELECT data FROM projects WHERE id=?")
        .get(first.projectId),
      before = jobHistoryUsage(db, "owner", policy);
    assert.equal(
      previewJobHistoryRetirement(db, first.id, "foreign", policy),
      undefined,
    );
    assert.equal(
      applyJobHistoryRetirement(
        db,
        first.id,
        "foreign",
        "a".repeat(64),
        policy,
      ),
      undefined,
    );
    const review = previewJobHistoryRetirement(
      db,
      first.id,
      "owner",
      policy,
    )!.preview!;
    assert.equal(downloadJobHistory(db, first.id, "foreign"), undefined);
    const archive = JSON.parse(downloadJobHistory(db, first.id, "owner")!);
    assert.equal(archive.jobId, first.id);
    assert(archive.details.report.private.includes("OLD_DETAIL_"));
    assert(JSON.stringify(archive.timeline).includes(first.source));
    assert(review.reclaimedBytes > 60000);
    assert.equal(review.sourceFiles, 1);
    const original = (
      db.prepare("SELECT data FROM jobs WHERE id=?").get(first.id) as {
        data: string;
      }
    ).data;
    db.prepare("UPDATE jobs SET data=? WHERE id=?").run(
      JSON.stringify({
        ...JSON.parse(original),
        error: "changed after review",
      }),
      first.id,
    );
    assert.throws(
      () =>
        applyJobHistoryRetirement(db, first.id, "owner", review.digest, policy),
      JobHistoryConflict,
    );
    assert.equal(
      (
        db
          .prepare("SELECT count(*) AS n FROM job_history_retirements")
          .get() as { n: number }
      ).n,
      0,
    );
    const current = previewJobHistoryRetirement(
        db,
        first.id,
        "owner",
        policy,
      )!.preview!,
      done = applyJobHistoryRetirement(
        db,
        first.id,
        "owner",
        current.digest,
        policy,
      )!;
    assert.equal(done.jobId, first.id);
    assert.equal(done.sourceFiles, 1);
    const after = jobHistoryUsage(db, "owner", policy);
    assert(after.bytes < before.bytes);
    assert.equal(after.fullJobs, 1);
    assert.equal(after.retiredJobs, 1);
    assert.deepEqual(
      applyJobHistoryRetirement(db, first.id, "owner", current.digest, policy),
      done,
    );
    assert.equal(jobHistoryUsage(db, "owner", policy).bytes, after.bytes);
    assert.throws(
      () => previewJobHistoryRetirement(db, other.id, "owner", policy),
      (error: unknown) =>
        error instanceof JobHistoryLimit && error.kind === "retired",
    );
    assert.deepEqual(
      db.prepare("SELECT data FROM projects WHERE id=?").get(first.projectId),
      filmBefore,
    );
    assert.equal(
      (
        db.prepare("SELECT timeline FROM jobs WHERE id=?").get(first.id) as {
          timeline: string;
        }
      ).timeline,
      "null",
    );
    assert(
      !JSON.stringify(
        db.prepare("SELECT data FROM jobs WHERE id=?").get(first.id),
      ).includes("OLD_DETAIL_"),
    );
    assert.equal(
      (
        db
          .prepare(
            "SELECT job_id FROM export_requests WHERE project_id=? AND request_key='same-intent'",
          )
          .get(first.projectId) as { job_id: string }
      ).job_id,
      first.id,
    );
    rebuildMediaReferences(db);
    assert(
      db
        .prepare("SELECT 1 FROM job_media_refs WHERE job_id=? AND asset_id=?")
        .get(first.id, first.source),
    );
    assert(
      db
        .prepare("SELECT 1 FROM job_media_refs WHERE job_id=? AND asset_id=?")
        .get(other.id, other.source),
    );
  }));
test("retirement waits for actual file settlement and native leases; Trash and deletion win before consent commits", () =>
  fixture(({ db, make }) => {
    const job = make();
    settleExportStorage(db, job.id, 7, 1, true);
    assert.throws(
      () => previewJobHistoryRetirement(db, job.id, "owner", policy),
      JobHistoryBusy,
    );
    settleExportStorage(db, job.id, 0, 0, true);
    const review = previewJobHistoryRetirement(
      db,
      job.id,
      "owner",
      policy,
    )!.preview!;
    db.prepare("INSERT INTO render_job_attempts VALUES(?,'fixture')").run(
      job.id,
    );
    assert.throws(
      () =>
        applyJobHistoryRetirement(db, job.id, "owner", review.digest, policy),
      JobHistoryBusy,
    );
    db.prepare("DELETE FROM render_job_attempts WHERE job_id=?").run(job.id);
    db.prepare("UPDATE projects SET trashed_at='fixture' WHERE id=?").run(
      job.projectId,
    );
    assert.equal(
      applyJobHistoryRetirement(db, job.id, "owner", review.digest, policy),
      undefined,
    );
    db.prepare("UPDATE projects SET trashed_at=NULL WHERE id=?").run(
      job.projectId,
    );
    db.prepare("INSERT INTO project_deletions VALUES(?)").run(job.projectId);
    assert.equal(
      applyJobHistoryRetirement(db, job.id, "owner", review.digest, policy),
      undefined,
    );
    assert.equal(
      (
        db
          .prepare("SELECT count(*) AS n FROM job_history_retirements")
          .get() as { n: number }
      ).n,
      0,
    );
  }));

test("activity pages transfer only bounded own metadata and bind stable encrypted cursors to the workspace and distinct history domain", () =>
  fixture(({ db, make }) => {
    process.env.BETTER_AUTH_SECRET = randomBytes(48).toString("base64url");
    const own = Array.from({ length: 26 }, () => make()),
      foreign = make("foreign");
    db.prepare("UPDATE projects SET trashed_at='fixture' WHERE id=?").run(
      own[25].projectId,
    );
    settleExportStorage(db, own[24].id, 7, 1, true);
    const first = ownedJobHistoryPage(db, "owner");
    assert.equal(first.items.length, 20);
    assert(first.nextBefore);
    assert.equal(first.unavailable, 0);
    assert(first.items[0].inTrash);
    assert.equal(first.items[0].eligible, false);
    assert.equal(first.items[1].eligible, false);
    assert(first.items[2].eligible);
    assert.deepEqual(
      first.items.map((value) => value.id),
      own
        .slice(6)
        .reverse()
        .map((value) => value.id),
    );
    const late = make(),
      second = ownedJobHistoryPage(db, "owner", {
        anchor: first.anchor,
        before: first.nextBefore,
      });
    assert.deepEqual(
      second.items.map((value) => value.id),
      own
        .slice(0, 6)
        .reverse()
        .map((value) => value.id),
    );
    assert.equal(second.nextBefore, null);
    const payload = JSON.stringify([first, second]);
    assert(Buffer.byteLength(payload) < 16000);
    for (const marker of [
      foreign.id,
      late.id,
      own[0].source,
      "OLD_DETAIL_",
      "timeline",
      "report",
      "workspaceId",
      "position",
    ])
      assert(!payload.includes(marker), marker);
    assert.throws(() =>
      ownedJobHistoryPage(db, "foreign", {
        anchor: first.anchor,
        before: first.nextBefore!,
      }),
    );
    assert.throws(() =>
      ownedJobHistoryPage(db, "owner", { before: first.nextBefore! }),
    );
    assert.throws(() =>
      ownedJobHistoryPage(db, "owner", {
        anchor: encodeExportCursor(
          "studio-job-history:v1",
          "owner",
          "anchor",
          [27],
        ),
      }),
    );
    assert.equal(ownedJobHistoryPage(db, "foreign").items[0].id, foreign.id);
  }));
