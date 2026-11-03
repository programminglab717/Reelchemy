import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { randomBytes, randomUUID } from "node:crypto";
import { retainedExportPage } from "../src/lib/retained-exports";
import { migrateExportStorage } from "../src/lib/export-storage-store";
import { migrateExportFileRemovals } from "../src/lib/export-file-store";
import { encodeExportCursor } from "../src/lib/export-history-cursor";
process.env.BETTER_AUTH_SECRET = randomBytes(48).toString("base64url");
test("studio-wide file pages enforce indexed owners, bounded metadata and stable opaque navigation while excluding deleted, active and empty exports", () => {
  const db = new Database(":memory:");
  db.exec(
    "CREATE TABLE projects(id TEXT PRIMARY KEY,data TEXT,workspace_id TEXT,trashed_at TEXT);CREATE TABLE jobs(id TEXT PRIMARY KEY,project_id TEXT,status TEXT,data TEXT);CREATE TABLE project_deletions(project_id TEXT)",
  );
  migrateExportFileRemovals(db);
  migrateExportStorage(db);
  const make = (owner = "owner", status = "completed", files = 1) => {
    const id = randomUUID(),
      projectId = randomUUID();
    db.prepare("INSERT INTO projects VALUES(?,?,?,NULL)").run(
      projectId,
      JSON.stringify({
        name: "Private project name",
        timeline: "NEVER_RETURN_PRIVATE_TIMELINE",
      }),
      owner,
    );
    db.prepare("INSERT INTO jobs VALUES(?,?,?,?)").run(
      id,
      projectId,
      status,
      JSON.stringify({
        id: "FORGED",
        report: { secret: "NEVER_RETURN_PRIVATE_REPORT" },
      }),
    );
    db.prepare(
      "INSERT INTO export_storage_entries VALUES(?,?,?,123,?,0,1048576,0)",
    ).run(id, projectId, owner, files);
    return { id, projectId };
  };
  try {
    const own = Array.from({ length: 23 }, () => make()),
      foreign = make("foreign"),
      active = make("owner", "queued"),
      empty = make("owner", "failed", 0),
      deleting = make(),
      trash = own[0];
    db.prepare("INSERT INTO project_deletions VALUES(?)").run(
      deleting.projectId,
    );
    db.prepare("UPDATE projects SET trashed_at='fixture' WHERE id=?").run(
      trash.projectId,
    );
    db.prepare("INSERT INTO render_job_attempts VALUES(?,'fixture')").run(
      own[22].id,
    );
    db.prepare(
      "INSERT INTO export_file_removals VALUES(?,?,?,'working','fixture',NULL,0,0,NULL,NULL,NULL)",
    ).run(own[21].id, own[21].projectId, "owner");
    const first = retainedExportPage(db, "owner");
    assert.equal(first.items.length, 20);
    assert(first.nextBefore);
    assert(first.items[0].processing);
    assert.equal(first.items[1].fileState, "working");
    assert.deepEqual(
      first.items.map((i) => i.id),
      own
        .slice(3)
        .reverse()
        .map((i) => i.id),
    );
    const late = make();
    const second = retainedExportPage(db, "owner", {
      anchor: first.anchor,
      before: first.nextBefore,
    });
    assert.deepEqual(
      second.items.map((i) => i.id),
      own
        .slice(0, 3)
        .reverse()
        .map((i) => i.id),
    );
    assert.equal(second.nextBefore, null);
    assert(second.items[2].inTrash);
    const payload = JSON.stringify([first, second]);
    for (const marker of [
      foreign.id,
      active.id,
      empty.id,
      deleting.id,
      late.id,
      "NEVER_RETURN_PRIVATE",
      "FORGED",
      "position",
      "workspaceId",
    ])
      assert(!payload.includes(marker), marker);
    assert.equal(retainedExportPage(db, "foreign").items[0].id, foreign.id);
    assert.throws(() =>
      retainedExportPage(db, "foreign", {
        anchor: first.anchor,
        before: first.nextBefore!,
      }),
    );
    assert.throws(() =>
      retainedExportPage(db, "owner", { before: first.nextBefore! }),
    );
    assert.throws(() =>
      retainedExportPage(db, "owner", {
        anchor: encodeExportCursor(own[0].projectId, "owner", "anchor", [10]),
      }),
    );
    assert.throws(() =>
      retainedExportPage(db, "owner", {
        anchor: first.anchor,
        before: first.nextBefore!.slice(0, -1) + "!",
      }),
    );
    db.prepare("UPDATE projects SET data='malformed' WHERE id=?").run(
      late.projectId,
    );
    assert.equal(
      retainedExportPage(db, "owner").items[0].projectName,
      "Saved project",
    );
    db.exec(
      "DELETE FROM schema_migrations WHERE id='export-storage-census-v1'",
    );
    const before = db
      .prepare("SELECT group_concat(data) AS value FROM jobs")
      .get();
    assert.equal(retainedExportPage(db, "owner").items.length, 20);
    assert.deepEqual(
      db.prepare("SELECT group_concat(data) AS value FROM jobs").get(),
      before,
    );
  } finally {
    db.close();
  }
});
