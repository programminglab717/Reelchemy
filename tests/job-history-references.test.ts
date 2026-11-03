import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import {
  migrateJobHistoryReferences,
  retiredJobManifest,
  readRetiredJob,
  retainedRetirementSourcesSql,
} from "../src/lib/job-history-references";
import {
  migrateMediaReferences,
  rebuildMediaReferences,
} from "../src/lib/media-references";
test("retired source manifests pin exact indexed owners and job-only media through old writes/rebuild attempts, then release only after job deletion", () => {
  const db = new Database(":memory:"),
    projectId = "owned-legacy-film",
    jobId = randomUUID(),
    source = randomUUID();
  db.exec(
    "CREATE TABLE projects(id TEXT PRIMARY KEY,workspace_id TEXT);CREATE TABLE jobs(id TEXT PRIMARY KEY,project_id TEXT,status TEXT,data TEXT,timeline TEXT);CREATE TABLE job_media_refs(job_id TEXT,asset_id TEXT,PRIMARY KEY(job_id,asset_id))",
  );
  db.prepare("INSERT INTO projects VALUES(?,'owner')").run(projectId);
  db.prepare("INSERT INTO jobs VALUES(?,?,'failed','{}','null')").run(
    jobId,
    projectId,
  );
  db.prepare("INSERT INTO job_media_refs VALUES(?,?)").run(jobId, source);
  migrateJobHistoryReferences(db);
  migrateJobHistoryReferences(db);
  const manifest = retiredJobManifest.parse({
    format: "reelchemy-retired-export-v1",
    jobId,
    projectId,
    workspaceId: "owner",
    retiredAt: new Date().toISOString(),
    digest: "a".repeat(64),
    sourceIds: [source],
  });
  const shell = JSON.stringify({
      id: jobId,
      projectId,
      status: "failed",
      retired: true,
      report: null,
    }),
    insert = db.prepare(
      "INSERT INTO job_history_retirements VALUES(?,?,?,?,?)",
    );
  try {
    for (const change of [
      { workspaceId: "foreign" },
      { projectId: "foreign" },
      { sourceIds: [] },
      { sourceIds: [randomUUID()] },
    ])
      assert.throws(() =>
        insert.run(
          jobId,
          projectId,
          "owner",
          JSON.stringify({ ...manifest, ...change }),
          shell,
        ),
      );
    db.transaction(() => {
      insert.run(jobId, projectId, "owner", JSON.stringify(manifest), shell);
      assert.throws(() => readRetiredJob(db, jobId));
      db.prepare("UPDATE jobs SET data=?,timeline='null' WHERE id=?").run(
        shell,
        jobId,
      );
    }).immediate();
    assert.deepEqual(readRetiredJob(db, jobId), manifest);
    assert.deepEqual(db.prepare(retainedRetirementSourcesSql).all(), [
      { job_id: jobId, asset_id: source },
    ]);
    for (const query of [
      "DELETE FROM job_media_refs",
      "DELETE FROM job_history_retirements",
      "UPDATE job_history_retirements SET workspace_id='foreign'",
      "UPDATE projects SET workspace_id='foreign'",
      'UPDATE jobs SET data=\'{"report":"regenerated"}\'',
      "UPDATE jobs SET timeline='{}'",
      "UPDATE jobs SET status='queued'",
      "UPDATE jobs SET project_id='foreign'",
    ])
      assert.throws(() => db.exec(query));
    assert.equal(
      (
        db.prepare("SELECT count(*) AS n FROM job_media_refs").get() as {
          n: number;
        }
      ).n,
      1,
    );
    db.prepare(
      "UPDATE jobs SET data=data,timeline=timeline,status=status",
    ).run();
    db.prepare("DELETE FROM jobs WHERE id=?").run(jobId);
    assert.equal(readRetiredJob(db, jobId), undefined);
    assert.equal(
      (
        db.prepare("SELECT count(*) AS n FROM job_media_refs").get() as {
          n: number;
        }
      ).n,
      0,
    );
  } finally {
    db.close();
  }
});
test("ambiguous, oversized or unsorted retired-source manifests are refused before persisting a receipt", () => {
  const input = {
    format: "reelchemy-retired-export-v1",
    jobId: randomUUID(),
    projectId: "film",
    workspaceId: "studio",
    retiredAt: new Date().toISOString(),
    digest: "b".repeat(64),
    sourceIds: [randomUUID()],
  };
  for (const value of [
    { ...input, sourceIds: [...input.sourceIds, ...input.sourceIds] },
    {
      ...input,
      sourceIds: Array.from({ length: 1025 }, () => randomUUID()).sort(),
    },
    { ...input, workspaceId: "\nowner" },
    { ...input, digest: "invalid" },
    { ...input, unexpected: true },
  ])
    assert(!retiredJobManifest.safeParse(value).success);
});
test("retirement strips a full timeline atomically while new reference triggers and explicit rebuilds retain its job-only originals", () => {
  const db = new Database(":memory:"),
    jobId = randomUUID(),
    source = randomUUID(),
    projectId = "legacy-source-film";
  db.exec(
    "CREATE TABLE projects(id TEXT PRIMARY KEY,data TEXT,workspace_id TEXT);CREATE TABLE jobs(id TEXT PRIMARY KEY,project_id TEXT,status TEXT,data TEXT,timeline TEXT)",
  );
  const timeline = JSON.stringify({
      scenes: [{ layers: [{ assetId: source }] }],
    }),
    data = JSON.stringify({
      id: jobId,
      projectId,
      status: "failed",
      report: { detail: "RETIRE_THIS_FULL_REPORT" },
    }),
    shell = JSON.stringify({
      id: jobId,
      projectId,
      status: "failed",
      retired: true,
      report: null,
    });
  db.prepare("INSERT INTO projects VALUES(?,'{}','owner')").run(projectId);
  db.prepare("INSERT INTO jobs VALUES(?,?,'failed',?,?)").run(
    jobId,
    projectId,
    data,
    timeline,
  );
  migrateMediaReferences(db);
  const manifest = retiredJobManifest.parse({
    format: "reelchemy-retired-export-v1",
    jobId,
    projectId,
    workspaceId: "owner",
    retiredAt: new Date().toISOString(),
    digest: "c".repeat(64),
    sourceIds: [source],
  });
  try {
    db.transaction(() => {
      db.prepare("INSERT INTO job_history_retirements VALUES(?,?,?,?,?)").run(
        jobId,
        projectId,
        "owner",
        JSON.stringify(manifest),
        shell,
      );
      db.prepare("UPDATE jobs SET data=?,timeline='null' WHERE id=?").run(
        shell,
        jobId,
      );
    }).immediate();
    const expected = [{ job_id: jobId, asset_id: source }];
    assert.deepEqual(
      db.prepare("SELECT * FROM job_media_refs").all(),
      expected,
    );
    assert.deepEqual(readRetiredJob(db, jobId), manifest);
    for (let attempt = 0; attempt < 3; attempt++) {
      rebuildMediaReferences(db);
      migrateMediaReferences(db);
      assert.deepEqual(
        db.prepare("SELECT * FROM job_media_refs").all(),
        expected,
      );
      assert.equal(
        (
          db.prepare("SELECT timeline FROM jobs WHERE id=?").get(jobId) as {
            timeline: string;
          }
        ).timeline,
        "null",
      );
    }
    assert.throws(() => db.exec("DELETE FROM job_media_refs"));
    assert.equal(
      (
        db.prepare("SELECT data FROM jobs WHERE id=?").get(jobId) as {
          data: string;
        }
      ).data,
      shell,
    );
    assert(!shell.includes("RETIRE_THIS_FULL_REPORT"));
  } finally {
    db.close();
  }
});
