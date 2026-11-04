import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { randomUUID, createHash } from "node:crypto";
import path from "node:path";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";
import {
  initializePrivacyVault,
  recordErasureApproval,
  type PrivacyVault,
} from "../src/lib/privacy-vault";
import { createErasureReceipt } from "../src/lib/account-erasure-approval";
import {
  migrateAccountErasures,
  beginStudioErasure,
  studioHasErasure,
  pendingStudioErasures,
  blockStudioErasure,
} from "../src/lib/account-erasure-store";
import {
  AccountErasureConflict,
  AccountErasureUnavailable,
} from "../src/lib/account-erasure-policy";
function fixture(run: (db: Database.Database, vault: PrivacyVault) => void) {
  const root = mkdtempSync(path.join(tmpdir(), "reelchemy-erasure-studio-")),
    db = new Database(":memory:");
  try {
    db.exec(
      `CREATE TABLE workspaces(id TEXT PRIMARY KEY,owner_id TEXT UNIQUE,name TEXT);CREATE TABLE projects(id TEXT PRIMARY KEY,workspace_id TEXT,data TEXT,trashed_at TEXT);CREATE TABLE jobs(id TEXT PRIMARY KEY,project_id TEXT,status TEXT,data TEXT,timeline TEXT);CREATE TABLE media_requests(id TEXT PRIMARY KEY,workspace_id TEXT,project_id TEXT,state TEXT,updated_at INTEGER,reserved_bytes INTEGER);CREATE TABLE provider_usage(id TEXT PRIMARY KEY,workspace_id TEXT,state TEXT,created_at INTEGER,reserved_micro_usd INTEGER);CREATE TABLE render_job_attempts(job_id TEXT PRIMARY KEY,started_at TEXT);`,
    );
    migrateAccountErasures(db);
    run(db, initializePrivacyVault(path.join(root, "vault")));
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
}
function seed(db: Database.Database, ownerId: string) {
  const workspaceId = randomUUID(),
    projectId = randomUUID(),
    jobId = randomUUID(),
    timeline = JSON.stringify({
      label: "Immutable original media/timeline",
      assetId: randomUUID(),
    });
  db.prepare("INSERT INTO workspaces VALUES(?,?,?)").run(
    workspaceId,
    ownerId,
    "Synthetic private studio",
  );
  db.prepare("INSERT INTO projects VALUES(?,?,?,NULL)").run(
    projectId,
    workspaceId,
    JSON.stringify({ name: "Original film", versions: ["retained"] }),
  );
  db.prepare("INSERT INTO jobs VALUES(?,?,?,?,?)").run(
    jobId,
    projectId,
    "rendering",
    JSON.stringify({ id: jobId, projectId, status: "rendering", events: [] }),
    timeline,
  );
  db.prepare("INSERT INTO render_job_attempts VALUES(?,?)").run(
    jobId,
    new Date().toISOString(),
  );
  db.prepare("INSERT INTO media_requests VALUES(?,?,?,'working',?,12345)").run(
    randomUUID(),
    workspaceId,
    projectId,
    Date.now(),
  );
  db.prepare(
    "INSERT INTO media_requests VALUES(?,?,NULL,'receiving',?,23456)",
  ).run(randomUUID(), workspaceId, Date.now());
  db.prepare("INSERT INTO provider_usage VALUES(?,?,'reserved',?,999)").run(
    randomUUID(),
    workspaceId,
    Date.now(),
  );
  return { ownerId, workspaceId, projectId, jobId, timeline };
}
function approve(
  vault: PrivacyVault,
  owner: { ownerId: string; workspaceId: string },
) {
  const requestId = randomUUID();
  recordErasureApproval(vault, {
    ...owner,
    requestId,
    receipt: createErasureReceipt(),
  });
  return { ...owner, requestId };
}
function snapshot(db: Database.Database) {
  return JSON.stringify(
    [
      "workspaces",
      "projects",
      "jobs",
      "media_requests",
      "provider_usage",
      "render_job_attempts",
      "account_erasures",
    ].map((table) => db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()),
  );
}

test("an independently approved barrier atomically hides/cancels owned work without releasing native/provider holds or changing other studios", () =>
  fixture((db, vault) => {
    const a = seed(db, "synthetic-owner-A"),
      b = seed(db, "synthetic-owner-B"),
      otherBefore = db
        .prepare("SELECT * FROM projects WHERE id=?")
        .get(b.projectId),
      timelineHash = createHash("sha256").update(a.timeline).digest("hex"),
      input = approve(vault, a);
    const first = beginStudioErasure(db, vault, input);
    assert.equal(first.state, "cleaning");
    assert(studioHasErasure(db, a.workspaceId));
    assert(!studioHasErasure(db, b.workspaceId));
    const project = db
      .prepare("SELECT * FROM projects WHERE id=?")
      .get(a.projectId) as { data: string; trashed_at: string };
    assert(project.trashed_at);
    assert.equal(JSON.parse(project.data).name, "Original film");
    const job = db.prepare("SELECT * FROM jobs WHERE id=?").get(a.jobId) as {
      status: string;
      timeline: string;
    };
    assert.equal(job.status, "cancelled");
    assert.equal(
      createHash("sha256").update(job.timeline).digest("hex"),
      timelineHash,
    );
    assert.equal(
      (
        db.prepare("SELECT count(*) n FROM render_job_attempts").get() as {
          n: number;
        }
      ).n,
      2,
    );
    assert.equal(
      (
        db
          .prepare(
            "SELECT sum(reserved_bytes) n FROM media_requests WHERE workspace_id=?",
          )
          .get(a.workspaceId) as { n: number }
      ).n,
      35801,
    );
    assert.deepEqual(
      (
        db
          .prepare("SELECT state FROM media_requests WHERE workspace_id=?")
          .all(a.workspaceId) as { state: string }[]
      ).map((row) => row.state),
      ["cancelling", "cancelling"],
    );
    assert.equal(
      (
        db
          .prepare(
            "SELECT reserved_micro_usd FROM provider_usage WHERE workspace_id=?",
          )
          .get(a.workspaceId) as { reserved_micro_usd: number }
      ).reserved_micro_usd,
      999,
    );
    assert.deepEqual(
      db.prepare("SELECT * FROM projects WHERE id=?").get(b.projectId),
      otherBefore,
    );
    const stable = snapshot(db);
    assert.deepEqual(beginStudioErasure(db, vault, input), first);
    assert.equal(snapshot(db), stable);
    assert.deepEqual(
      pendingStudioErasures(db).map((row) => row.workspaceId),
      [a.workspaceId],
    );
    blockStudioErasure(db, a.workspaceId);
    assert.equal(pendingStudioErasures(db)[0].state, "blocked");
    assert.throws(
      () => pendingStudioErasures(db, 11),
      AccountErasureUnavailable,
    );
  }));

test("stale/older SQL producers cannot restore or grow an erased studio while terminal cleanup and other owners remain usable", () =>
  fixture((db, vault) => {
    const a = seed(db, "owner-A"),
      b = seed(db, "owner-B");
    beginStudioErasure(db, vault, approve(vault, a));
    const refused = [
      () =>
        db
          .prepare("INSERT INTO workspaces VALUES(?,?,?)")
          .run(randomUUID(), a.ownerId, "recreated"),
      () =>
        db
          .prepare("INSERT INTO projects VALUES(?,?,?,NULL)")
          .run(randomUUID(), a.workspaceId, "{}"),
      () =>
        db
          .prepare("UPDATE projects SET trashed_at=NULL WHERE id=?")
          .run(a.projectId),
      () =>
        db.prepare("UPDATE projects SET data='{}' WHERE id=?").run(a.projectId),
      () =>
        db
          .prepare("UPDATE projects SET workspace_id=? WHERE id=?")
          .run(b.workspaceId, a.projectId),
      () =>
        db
          .prepare("UPDATE projects SET workspace_id=? WHERE id=?")
          .run(a.workspaceId, b.projectId),
      () =>
        db
          .prepare("INSERT INTO jobs VALUES(?,?,?,?,?)")
          .run(randomUUID(), a.projectId, "queued", "{}", "null"),
      () =>
        db
          .prepare("UPDATE jobs SET status='rendering' WHERE id=?")
          .run(a.jobId),
      () =>
        db
          .prepare("UPDATE jobs SET project_id=? WHERE id=?")
          .run(b.projectId, a.jobId),
      () =>
        db
          .prepare(
            "INSERT INTO media_requests VALUES(?,?,NULL,'receiving',?,0)",
          )
          .run(randomUUID(), a.workspaceId, Date.now()),
      () =>
        db
          .prepare(
            "UPDATE media_requests SET state='working' WHERE workspace_id=?",
          )
          .run(a.workspaceId),
      () =>
        db
          .prepare(
            "UPDATE media_requests SET workspace_id=? WHERE workspace_id=?",
          )
          .run(b.workspaceId, a.workspaceId),
      () =>
        db
          .prepare("INSERT INTO provider_usage VALUES(?,?,'reserved',?,1)")
          .run(randomUUID(), a.workspaceId, Date.now()),
    ];
    for (const mutate of refused) assert.throws(mutate, /Account deletion/);
    db.prepare("UPDATE jobs SET status='failed',data='{}' WHERE id=?").run(
      a.jobId,
    );
    db.prepare(
      "UPDATE media_requests SET state='cancelled',reserved_bytes=0 WHERE workspace_id=?",
    ).run(a.workspaceId);
    db.prepare("UPDATE projects SET data=? WHERE id=?").run(
      JSON.stringify({ name: "Other owner's current film" }),
      b.projectId,
    );
    db.prepare("INSERT INTO provider_usage VALUES(?,?,'reserved',?,1)").run(
      randomUUID(),
      b.workspaceId,
      Date.now(),
    );
    assert.throws(
      () => db.prepare("DELETE FROM account_erasures").run(),
      /retained/,
    );
    assert.throws(
      () => db.prepare("UPDATE account_erasures SET owner_id='forged'").run(),
      /immutable/,
    );
  }));

test("missing, foreign or stale independent authority refuses the whole barrier without partial Trash/cancellation", () =>
  fixture((db, vault) => {
    const a = seed(db, "owner-A"),
      b = seed(db, "owner-B"),
      before = snapshot(db);
    assert.throws(
      () =>
        beginStudioErasure(db, vault, {
          requestId: randomUUID(),
          ownerId: a.ownerId,
          workspaceId: a.workspaceId,
        }),
      AccountErasureConflict,
    );
    assert.equal(snapshot(db), before);
    const own = approve(vault, a);
    assert.throws(
      () => beginStudioErasure(db, vault, { ...own, ownerId: b.ownerId }),
      AccountErasureConflict,
    );
    assert.throws(
      () =>
        beginStudioErasure(db, vault, { ...own, workspaceId: b.workspaceId }),
      AccountErasureConflict,
    );
    assert.equal(snapshot(db), before);
    db.prepare("UPDATE workspaces SET owner_id='new-owner' WHERE id=?").run(
      a.workspaceId,
    );
    const stale = snapshot(db);
    assert.throws(
      () => beginStudioErasure(db, vault, own),
      AccountErasureConflict,
    );
    assert.equal(snapshot(db), stale);
  }));
