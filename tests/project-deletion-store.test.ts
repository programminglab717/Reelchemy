import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { randomUUID, createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  migrateMediaReferences,
  mediaReferencedOutsideProject,
} from "../src/lib/media-references";
import {
  migrateProjectDeletions,
  requestProjectDeletion,
  getProjectDeletion,
  listProjectDeletions,
  claimProjectDeletion,
  reserveDeletionMedia,
  failProjectDeletion,
  finishProjectDeletion,
  omitPendingDeletionsFromSnapshot,
} from "../src/lib/project-deletion-store";
import { ProjectDeletionConflict } from "../src/lib/project-deletion-policy";

function database() {
  const db = new Database(":memory:");
  db.exec(`CREATE TABLE projects(id TEXT PRIMARY KEY,data TEXT NOT NULL,workspace_id TEXT,trashed_at TEXT);
    CREATE TABLE jobs(id TEXT PRIMARY KEY,project_id TEXT NOT NULL,status TEXT NOT NULL,data TEXT NOT NULL,timeline TEXT NOT NULL);
    CREATE TABLE export_requests(project_id TEXT,request_key TEXT,job_id TEXT,request_version TEXT);
    CREATE TABLE media_sizes(asset_id TEXT PRIMARY KEY,bytes INTEGER NOT NULL);`);
  migrateMediaReferences(db);
  migrateProjectDeletions(db);
  return db;
}
function project(
  db: Database.Database,
  owner: string,
  assets: string[] = [],
  trashed = true,
  history: string[] = [],
) {
  const id = randomUUID();
  db.prepare("INSERT INTO projects VALUES (?,?,?,?)").run(
    id,
    JSON.stringify({
      name: "Private cleanup fixture",
      assets: assets.map((id) => ({ id })),
      revisions: history.map((assetId) => ({
        timeline: { layers: [{ assetId }] },
      })),
    }),
    owner,
    trashed ? new Date().toISOString() : null,
  );
  for (const id of assets)
    db.prepare("INSERT OR IGNORE INTO media_sizes VALUES (?,?)").run(id, 2048);
  return id;
}
function job(
  db: Database.Database,
  projectId: string,
  assets: string[] = [],
  status = "queued",
) {
  const id = randomUUID();
  db.prepare("INSERT INTO jobs VALUES (?,?,?,?,?)").run(
    id,
    projectId,
    status,
    JSON.stringify({ id, projectId, status }),
    JSON.stringify({ layers: assets.map((assetId) => ({ assetId })) }),
  );
  db.prepare("INSERT INTO export_requests VALUES (?,?,?,?)").run(
    projectId,
    randomUUID(),
    id,
    "null",
  );
  return id;
}
function hash(db: Database.Database) {
  const tables = [
    "projects",
    "jobs",
    "export_requests",
    "media_sizes",
    "project_media_refs",
    "job_media_refs",
    "project_deletions",
    "media_deletion_targets",
  ];
  return createHash("sha256")
    .update(
      JSON.stringify(
        tables.map((t) =>
          db.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all(),
        ),
      ),
    )
    .digest("hex");
}
test("deletion intent requires the owning studio and Trash, cancels jobs atomically and stays private/idempotent", () => {
  const db = database();
  const owner = randomUUID(),
    other = randomUUID(),
    asset = randomUUID();
  try {
    const active = project(db, owner, [], false);
    assert.throws(
      () => requestProjectDeletion(db, active, owner),
      ProjectDeletionConflict,
    );
    const p = project(db, owner, [asset]);
    const queued = job(db, p),
      rendering = job(db, p, [], "rendering");
    const beforeMigration = hash(db);
    db.exec(`DELETE FROM schema_migrations WHERE id='project-deletion-guards-v1';
      DROP TRIGGER deleting_project_job_move;
      CREATE TRIGGER deleting_project_job_move BEFORE UPDATE OF project_id ON jobs WHEN EXISTS(SELECT 1 FROM project_deletions WHERE project_id=NEW.project_id) BEGIN SELECT RAISE(ABORT,'Project is scheduled for permanent deletion.'); END;`);
    migrateProjectDeletions(db);
    migrateProjectDeletions(db);
    assert.equal(
      hash(db),
      beforeMigration,
      "atomic guard initialization replaces a partial setup without changing project/job data",
    );
    const before = db.prepare("SELECT data FROM projects WHERE id=?").get(p);
    assert.equal(requestProjectDeletion(db, p, other), undefined);
    const first = requestProjectDeletion(db, p, owner)!;
    assert.equal(first.state, "queued");
    assert.deepEqual(requestProjectDeletion(db, p, owner), first);
    assert.deepEqual(
      db.prepare("SELECT data FROM projects WHERE id=?").get(p),
      before,
      "intent retains source content until cleanup finishes",
    );
    for (const id of [queued, rendering]) {
      const row = db
        .prepare(
          "SELECT status,json_extract(data,'$.status') AS value FROM jobs WHERE id=?",
        )
        .get(id) as { status: string; value: string };
      assert.deepEqual(row, { status: "cancelled", value: "cancelled" });
    }
    assert.equal(getProjectDeletion(db, p, other), undefined);
    assert.equal(listProjectDeletions(db, other).total, 0);
    const list = listProjectDeletions(db, owner);
    assert.equal(list.total, 1);
    assert(!JSON.stringify(list).includes(asset));
    assert(!JSON.stringify(list).includes(owner));
    assert.throws(
      () => db.prepare("UPDATE projects SET trashed_at=NULL WHERE id=?").run(p),
      /scheduled for permanent deletion/,
    );
    assert.throws(() => job(db, p), /scheduled for permanent deletion/);
    assert.throws(
      () =>
        db
          .prepare("UPDATE jobs SET project_id=? WHERE id=?")
          .run(randomUUID(), queued),
      /scheduled for permanent deletion/,
      "a legacy writer cannot move a snapshotted export out from under its cleanup manifest",
    );
  } finally {
    db.close();
  }
});
test("shared uploads, historical timelines and other projects' immutable jobs cannot be reserved or removed", () => {
  const db = database();
  const owner = randomUUID();
  const [unique, current, historical, snapshot] = Array.from(
    { length: 4 },
    () => randomUUID(),
  );
  try {
    const p = project(db, owner, [unique, current, historical, snapshot]);
    const keepCurrent = project(db, owner, [current]);
    const keepHistory = project(db, owner, [], true, [historical]);
    const keepJob = project(db, owner);
    const retainedJob = job(db, keepJob, [snapshot], "completed");
    const ownJob = job(db, p, [unique]);
    const untouched = db
      .prepare("SELECT data FROM projects WHERE id IN (?,?,?) ORDER BY id")
      .all(keepCurrent, keepHistory, keepJob);
    requestProjectDeletion(db, p, owner);
    const task = claimProjectDeletion(db)!;
    assert.deepEqual(reserveDeletionMedia(db, task), [unique]);
    const before = db
      .prepare("SELECT data FROM projects WHERE id=?")
      .get(keepCurrent);
    assert.throws(
      () =>
        db
          .prepare("UPDATE projects SET data=? WHERE id=?")
          .run(
            JSON.stringify({ assets: [{ id: current }, { id: unique }] }),
            keepCurrent,
          ),
      /Media is scheduled/,
    );
    assert.deepEqual(
      db.prepare("SELECT data FROM projects WHERE id=?").get(keepCurrent),
      before,
    );
    assert.equal(
      mediaReferencedOutsideProject(db, current, p),
      true,
      "aborted reinsert preserves existing references",
    );
    assert.throws(() => job(db, keepJob, [unique]), /Media is scheduled/);
    const result = finishProjectDeletion(db, task); // Filesystem completion is tested with the real worker separately.
    assert.equal(result.state, "completed");
    assert.equal(result.name, null);
    assert.equal(
      db.prepare("SELECT id FROM projects WHERE id=?").get(p),
      undefined,
    );
    assert.equal(
      db.prepare("SELECT id FROM jobs WHERE id=?").get(ownJob),
      undefined,
    );
    assert(db.prepare("SELECT id FROM jobs WHERE id=?").get(retainedJob));
    assert.equal(
      db
        .prepare("SELECT asset_id FROM media_sizes WHERE asset_id=?")
        .get(unique),
      undefined,
    );
    for (const id of [current, historical, snapshot])
      assert.equal(mediaReferencedOutsideProject(db, id, p), true);
    assert.deepEqual(
      db
        .prepare("SELECT data FROM projects WHERE id IN (?,?,?) ORDER BY id")
        .all(keepCurrent, keepHistory, keepJob),
      untouched,
    );
    assert.equal(
      (
        db
          .prepare("SELECT count(*) AS n FROM media_deletion_targets")
          .get() as { n: number }
      ).n,
      0,
    );
    assert.deepEqual(requestProjectDeletion(db, p, owner), result);
    assert.throws(
      () =>
        db
          .prepare("INSERT OR REPLACE INTO projects VALUES (?,?,?,?)")
          .run(p, "{}", randomUUID(), null),
      /scheduled for permanent deletion/,
    );
    const receipt = db
      .prepare("SELECT name,manifest FROM project_deletions WHERE project_id=?")
      .get(p);
    assert.deepEqual(receipt, { name: null, manifest: null });
  } finally {
    db.close();
  }
});
test("cleanup failures back off, stop after three attempts, allow explicit retry and resume working intent", () => {
  const db = database();
  const owner = randomUUID();
  try {
    const p = project(db, owner, [randomUUID()]);
    requestProjectDeletion(db, p, owner);
    const first = claimProjectDeletion(db, 0)!;
    assert.equal(first.attempts, 1);
    failProjectDeletion(db, first, 0);
    assert.equal(claimProjectDeletion(db, 4999), undefined);
    const second = claimProjectDeletion(db, 5000)!;
    assert.equal(second.attempts, 2);
    failProjectDeletion(db, second, 5000);
    const third = claimProjectDeletion(db, 15000)!;
    assert.equal(third.attempts, 3);
    failProjectDeletion(db, third, 15000);
    assert.equal(getProjectDeletion(db, p, owner)!.state, "failed");
    assert.equal(claimProjectDeletion(db, 1000000), undefined);
    assert.equal(requestProjectDeletion(db, p, owner)!.state, "queued");
    const retry = claimProjectDeletion(db, 1000000)!;
    assert.equal(retry.attempts, 1);
    assert.deepEqual(
      claimProjectDeletion(db, 1000001),
      retry,
      "restart resumes the same in-progress attempt",
    );
  } finally {
    db.close();
  }
});
test("malformed manifests or changed ownership fail closed without exposing private input", () => {
  const db = database();
  const owner = randomUUID();
  try {
    const p = project(db, owner, [randomUUID()]);
    requestProjectDeletion(db, p, owner);
    db.prepare(
      "UPDATE project_deletions SET manifest=? WHERE project_id=?",
    ).run("private-malformed-canary", p);
    assert.equal(claimProjectDeletion(db), undefined);
    assert.equal(getProjectDeletion(db, p, owner)!.state, "failed");
    assert(
      !JSON.stringify(getProjectDeletion(db, p, owner)).includes(
        "private-malformed-canary",
      ),
    );
    assert(db.prepare("SELECT id FROM projects WHERE id=?").get(p));
    const changedOwner = project(db, owner, [randomUUID()]);
    requestProjectDeletion(db, changedOwner, owner);
    db.prepare("UPDATE projects SET workspace_id=? WHERE id=?").run(
      randomUUID(),
      changedOwner,
    );
    assert.equal(claimProjectDeletion(db), undefined);
    assert.equal(
      (
        db
          .prepare("SELECT count(*) AS n FROM media_deletion_targets")
          .get() as { n: number }
      ).n,
      0,
    );
  } finally {
    db.close();
  }
});
test("a new snapshot omits pending deletion content and preserves live source, shared references and erasure intent", async () => {
  const db = database();
  const owner = randomUUID();
  const dir = await mkdtemp(
    path.join(tmpdir(), "reelchemy-deletion-snapshot-"),
  );
  let copy: Database.Database | undefined;
  try {
    const [unique, shared] = [randomUUID(), randomUUID()];
    const p = project(db, owner, [unique, shared]);
    const kept = project(db, owner, [shared]);
    job(db, p, [unique]);
    job(db, kept, [shared], "completed");
    requestProjectDeletion(db, p, owner);
    const task = claimProjectDeletion(db)!;
    reserveDeletionMedia(db, task);
    const before = hash(db);
    const file = path.join(dir, "snapshot.sqlite");
    await db.backup(file);
    copy = new Database(file);
    assert.equal(omitPendingDeletionsFromSnapshot(copy), 1);
    assert.equal(
      copy.prepare("SELECT id FROM projects WHERE id=?").get(p),
      undefined,
    );
    assert(copy.prepare("SELECT id FROM projects WHERE id=?").get(kept));
    assert.equal(getProjectDeletion(copy, p, owner)!.state, "completed");
    assert.equal(getProjectDeletion(copy, p, owner)!.name, null);
    assert.equal(
      (
        copy
          .prepare("SELECT count(*) AS n FROM media_deletion_targets")
          .get() as { n: number }
      ).n,
      0,
    );
    assert.equal(mediaReferencedOutsideProject(copy, shared, p), true);
    assert.equal(hash(db), before, "only the new snapshot is changed");
    assert.equal(omitPendingDeletionsFromSnapshot(copy), 0);
  } finally {
    copy?.close();
    db.close();
    await rm(dir, { recursive: true, force: true });
  }
});
