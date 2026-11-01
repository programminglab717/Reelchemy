import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { randomUUID, createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import {
  migrateMediaReferences,
  rebuildMediaReferences,
  mediaReferencedOutsideProject,
} from "../src/lib/media-references";

function database(file = ":memory:") {
  const db = new Database(file);
  db.pragma("journal_mode = WAL");
  db.pragma("busy_timeout = 5000");
  db.exec(
    "CREATE TABLE projects(id TEXT PRIMARY KEY,data TEXT NOT NULL); CREATE TABLE jobs(id TEXT PRIMARY KEY,project_id TEXT NOT NULL,timeline TEXT NOT NULL);",
  );
  return db;
}
function rows(db: Database.Database) {
  return createHash("sha256")
    .update(
      JSON.stringify({
        projects: db.prepare("SELECT * FROM projects ORDER BY id").all(),
        jobs: db.prepare("SELECT * FROM jobs ORDER BY id").all(),
      }),
    )
    .digest("hex");
}
test("media reference census preserves source rows and includes retained uploads, historical timelines and immutable jobs", () => {
  const db = database();
  try {
    const [upload, history, audio, job] = Array.from({ length: 4 }, () =>
      randomUUID(),
    );
    db.prepare("INSERT INTO projects VALUES (?,?)").run(
      "p1",
      JSON.stringify({
        assets: [{ id: upload }],
        timeline: { audioTracks: [{ assetId: audio }] },
        revisions: [
          {
            timeline: {
              scenes: [
                {
                  layers: [
                    { assetId: history },
                    { assetId: history },
                    { assetId: "../../private-auth/auth.sqlite" },
                  ],
                },
              ],
            },
          },
        ],
      }),
    );
    db.prepare("INSERT INTO jobs VALUES (?,?,?)").run(
      "j1",
      "p1",
      JSON.stringify({ scenes: [{ layers: [{ assetId: job }] }] }),
    );
    const before = rows(db);
    migrateMediaReferences(db);
    assert.equal(rows(db), before);
    assert.equal(
      (
        db.prepare("SELECT count(*) AS n FROM project_media_refs").get() as {
          n: number;
        }
      ).n,
      3,
    );
    assert.equal(
      (
        db.prepare("SELECT count(*) AS n FROM job_media_refs").get() as {
          n: number;
        }
      ).n,
      1,
    );
    for (const id of [upload, history, audio, job]) {
      assert.equal(mediaReferencedOutsideProject(db, id, "p1"), false);
      assert.equal(
        mediaReferencedOutsideProject(db, id, "another-project"),
        true,
      );
    }
    migrateMediaReferences(db);
    assert.equal(rows(db), before);
    assert.throws(
      () =>
        mediaReferencedOutsideProject(
          db,
          "../../private-auth/auth.sqlite",
          "p1",
        ),
      /Invalid media/,
    );
  } finally {
    db.close();
  }
});
test("another process using raw legacy writes keeps the media index current without importing new application code", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "reelchemy-media-refs-"));
  const file = path.join(dir, "studio.sqlite"),
    db = database(file);
  const [oldAsset, replacement, retainedJob] = Array.from({ length: 3 }, () =>
    randomUUID(),
  );
  try {
    db.prepare("INSERT INTO projects VALUES (?,?)").run(
      "p1",
      JSON.stringify({ assets: [{ id: oldAsset }] }),
    );
    db.prepare("INSERT INTO jobs VALUES (?,?,?)").run(
      "j1",
      "p1",
      JSON.stringify({ assetId: retainedJob }),
    );
    migrateMediaReferences(db);
    execFileSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `
      import Database from 'better-sqlite3';
      const db = new Database(process.argv[1]); db.pragma('busy_timeout=5000');
      db.prepare('UPDATE projects SET data=? WHERE id=?').run(JSON.stringify({assets:[{id:process.argv[2]}]}),'p1');
      db.prepare('INSERT INTO projects VALUES (?,?)').run('p2',JSON.stringify({timeline:{assetId:process.argv[3]}}));
      db.close();
    `,
        file,
        replacement,
        retainedJob,
      ],
      { timeout: 10000, stdio: ["ignore", "pipe", "pipe"] },
    );
    assert.equal(mediaReferencedOutsideProject(db, oldAsset, "other"), false);
    assert.equal(mediaReferencedOutsideProject(db, replacement, "other"), true);
    assert.equal(mediaReferencedOutsideProject(db, retainedJob, "p1"), true);
    db.prepare("INSERT OR REPLACE INTO projects VALUES (?,?)").run(
      "p1",
      JSON.stringify({ assets: [{ id: oldAsset }] }),
    );
    assert.equal(
      mediaReferencedOutsideProject(db, replacement, "other"),
      false,
      "legacy REPLACE removes obsolete references",
    );
    db.prepare("INSERT OR IGNORE INTO projects VALUES (?,?)").run(
      "p1",
      JSON.stringify({ assets: [{ id: replacement }] }),
    );
    assert.equal(
      mediaReferencedOutsideProject(db, oldAsset, "other"),
      true,
      "an ignored insert cannot erase the retained index",
    );
    assert.equal(
      mediaReferencedOutsideProject(db, replacement, "other"),
      false,
    );
    db.prepare("DELETE FROM projects WHERE id=?").run("p2");
    assert.equal(mediaReferencedOutsideProject(db, retainedJob, "p1"), false);
    assert.equal(
      mediaReferencedOutsideProject(db, retainedJob, "other"),
      true,
      "the immutable job still protects the source even after metadata changes",
    );
    db.prepare("DELETE FROM jobs WHERE id=?").run("j1");
    assert.equal(
      mediaReferencedOutsideProject(db, retainedJob, "other"),
      false,
    );
  } finally {
    db.close();
    await rm(dir, { recursive: true, force: true });
  }
});
test("reference changes roll back with their project/job transaction and deletion removes only matching rows", () => {
  const db = database();
  const [first, second] = [randomUUID(), randomUUID()];
  try {
    migrateMediaReferences(db);
    for (const id of ["p1", "p2"])
      db.prepare("INSERT INTO projects VALUES (?,?)").run(
        id,
        JSON.stringify({ assets: [{ id: first }] }),
      );
    db.prepare("INSERT INTO jobs VALUES (?,?,?)").run(
      "j1",
      "p1",
      JSON.stringify({ assetId: first }),
    );
    assert.throws(
      () =>
        db
          .transaction(() => {
            db.prepare("UPDATE projects SET data=? WHERE id=?").run(
              JSON.stringify({ assets: [{ id: second }] }),
              "p1",
            );
            db.prepare("UPDATE jobs SET timeline=? WHERE id=?").run(
              JSON.stringify({ assetId: second }),
              "j1",
            );
            throw new Error("rollback");
          })
          .immediate(),
      /rollback/,
    );
    assert.equal(mediaReferencedOutsideProject(db, first, "p2"), true);
    assert.equal(mediaReferencedOutsideProject(db, second, "other"), false);
    db.prepare("DELETE FROM projects WHERE id=?").run("p1");
    assert.equal(
      mediaReferencedOutsideProject(db, first, "p2"),
      true,
      "a saved job remains a reference",
    );
    db.prepare("DELETE FROM jobs WHERE id=?").run("j1");
    assert.equal(mediaReferencedOutsideProject(db, first, "p2"), false);
    assert.equal(
      mediaReferencedOutsideProject(db, first, "p1"),
      true,
      "the other project's retained media remains indexed",
    );
  } finally {
    db.close();
  }
});
test("explicit recount repairs derived indexes without modifying unusual legacy metadata", () => {
  const db = database();
  const [first, second] = [randomUUID(), randomUUID()];
  try {
    migrateMediaReferences(db);
    db.prepare("INSERT INTO projects VALUES (?,?)").run(
      "p1",
      JSON.stringify({
        assets: [
          null,
          "old partial metadata",
          { id: first },
          { id: first.toUpperCase() },
        ],
        timeline: { assetId: second },
      }),
    );
    const before = rows(db);
    db.exec("DELETE FROM project_media_refs");
    assert.equal(mediaReferencedOutsideProject(db, first, "other"), false);
    assert.deepEqual(rebuildMediaReferences(db), { projects: 2, jobs: 0 });
    assert.equal(rows(db), before);
    assert.equal(mediaReferencedOutsideProject(db, first, "other"), true);
    assert.equal(mediaReferencedOutsideProject(db, second, "other"), true);
  } finally {
    db.close();
  }
});
