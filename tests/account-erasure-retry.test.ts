import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  mkdirSync,
  chmodSync,
  existsSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";
import {
  initializePrivacyVault,
  recordErasureApproval,
  advanceErasureState,
  type PrivacyVault,
} from "../src/lib/privacy-vault";
import { createErasureReceipt } from "../src/lib/account-erasure-approval";
import {
  migrateAccountErasures,
  beginStudioErasure,
} from "../src/lib/account-erasure-store";
import {
  retryErasedProjects,
  scheduleErasedProjects,
} from "../src/lib/account-erasure-cleanup-store";
import {
  migrateProjectDeletions,
  requestProjectDeletion,
} from "../src/lib/project-deletion-store";
import { ProjectDeletionConflict } from "../src/lib/project-deletion-policy";
import {
  AccountErasureConflict,
  AccountErasureUnavailable,
} from "../src/lib/account-erasure-policy";
import { ProviderUsageStore } from "../src/lib/provider-usage-store";
import { providerBudgetPolicy } from "../src/lib/provider-budget-policy";
import { migrateAuthErasures } from "../src/lib/auth-erasure-store";

function fixture(
  run: (db: Database.Database, vault: PrivacyVault, root: string) => void,
) {
  const root = mkdtempSync(path.join(tmpdir(), "reelchemy-erasure-retry-"));
  mkdirSync(path.join(root, "data"), { mode: 0o700 });
  const file = path.join(root, "data", "studio.sqlite");
  const db = new Database(file);
  chmodSync(file, 0o600);
  try {
    db.exec(`
      CREATE TABLE workspaces(id TEXT PRIMARY KEY,owner_id TEXT UNIQUE,name TEXT);
      CREATE TABLE projects(id TEXT PRIMARY KEY,workspace_id TEXT,data TEXT,trashed_at TEXT);
      CREATE TABLE jobs(id TEXT PRIMARY KEY,project_id TEXT,status TEXT,data TEXT,timeline TEXT);
      CREATE TABLE project_media_refs(project_id TEXT,asset_id TEXT);
      CREATE TABLE job_media_refs(job_id TEXT,asset_id TEXT);
      CREATE TABLE render_job_attempts(job_id TEXT PRIMARY KEY,started_at TEXT);
    `);
    new ProviderUsageStore(db);
    migrateProjectDeletions(db);
    migrateAccountErasures(db);
    run(db, initializePrivacyVault(path.join(root, "privacy")), root);
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
}
function identity(db: Database.Database, projects = 1, projectIds?: string[]) {
  const input = {
    ownerId: randomUUID(),
    workspaceId: randomUUID(),
    requestId: randomUUID(),
  };
  db.prepare("INSERT INTO workspaces VALUES(?,?,?)").run(
    input.workspaceId,
    input.ownerId,
    "Synthetic private studio",
  );
  const ids =
    projectIds ?? Array.from({ length: projects }, () => randomUUID()).sort();
  for (const id of ids)
    db.prepare("INSERT INTO projects VALUES(?,?,?,?)").run(
      id,
      input.workspaceId,
      JSON.stringify({ name: "Synthetic film" }),
      new Date().toISOString(),
    );
  return { ...input, ids };
}
function approve(
  db: Database.Database,
  vault: PrivacyVault,
  input: ReturnType<typeof identity>,
) {
  const context = {
    ownerId: input.ownerId,
    workspaceId: input.workspaceId,
    requestId: input.requestId,
  };
  recordErasureApproval(vault, { ...context, receipt: createErasureReceipt() });
  beginStudioErasure(db, vault, context);
  for (const id of input.ids) {
    requestProjectDeletion(db, id, input.workspaceId);
    db.prepare(
      "UPDATE project_deletions SET state='failed',attempts=3,error='Synthetic failure' WHERE project_id=?",
    ).run(id);
  }
  return context;
}
function tasks(db: Database.Database) {
  return db
    .prepare("SELECT * FROM project_deletions ORDER BY project_id")
    .all();
}

test("explicit account cleanup retry is bounded and preserves other studios, native/provider holds and approval bytes", () =>
  fixture((db, vault) => {
    const a = identity(db, 7),
      b = identity(db);
    requestProjectDeletion(db, b.ids[0], b.workspaceId);
    db.prepare("UPDATE project_deletions SET state='failed',attempts=3").run();
    const jobId = randomUUID();
    db.prepare("INSERT INTO jobs VALUES(?,?,'rendering','{}','{}')").run(
      jobId,
      a.ids[0],
    );
    db.prepare("INSERT INTO render_job_attempts VALUES(?,?)").run(
      jobId,
      new Date().toISOString(),
    );
    new ProviderUsageStore(db).reserve(
      a.workspaceId,
      {
        provider: "compatible",
        model: "synthetic-offline",
        payloadBytes: 1000,
      },
      providerBudgetPolicy({
        REELCHEMY_AI_INPUT_USD_PER_MILLION: "1",
        REELCHEMY_AI_OUTPUT_USD_PER_MILLION: "2",
      }),
    );
    const context = approve(db, vault, a);
    const retainedTables = [
      "jobs",
      "render_job_attempts",
      "provider_usage",
      "projects",
    ];
    const retained = retainedTables.map((t) =>
      db.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all(),
    );
    const otherTask = db
      .prepare("SELECT * FROM project_deletions WHERE project_id=?")
      .get(b.ids[0]);
    const journal = readFileSync(path.join(vault.directory, "journal.sqlite"));
    assert.deepEqual(scheduleErasedProjects(db, vault, context), {
      scheduled: 0,
      blocked: true,
    });
    assert.deepEqual(retryErasedProjects(db, vault, context, 2), {
      requeued: 2,
      remainingFailed: 5,
    });
    assert.deepEqual(retryErasedProjects(db, vault, context), {
      requeued: 5,
      remainingFailed: 0,
    });
    assert.deepEqual(retryErasedProjects(db, vault, context), {
      requeued: 0,
      remainingFailed: 0,
    });
    assert.equal(
      (
        db
          .prepare(
            "SELECT count(*) n FROM project_deletions WHERE workspace_id=? AND state='queued' AND attempts=0 AND error IS NULL",
          )
          .get(a.workspaceId) as { n: number }
      ).n,
      7,
    );
    assert.deepEqual(
      db
        .prepare("SELECT * FROM project_deletions WHERE project_id=?")
        .get(b.ids[0]),
      otherTask,
    );
    assert.deepEqual(
      retainedTables.map((t) =>
        db.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all(),
      ),
      retained,
    );
    assert.deepEqual(
      readFileSync(path.join(vault.directory, "journal.sqlite")),
      journal,
    );
  }));

function accountStore(root: string, vault: PrivacyVault) {
  const auth = path.join(root, "auth");
  mkdirSync(auth, { mode: 0o700 });
  const file = path.join(auth, "auth.sqlite"),
    db = new Database(file);
  try {
    db.exec(
      "CREATE TABLE user(id TEXT);CREATE TABLE session(userId TEXT);CREATE TABLE account(userId TEXT);CREATE TABLE verification(value TEXT);",
    );
    migrateAuthErasures(db, vault);
  } finally {
    db.close();
  }
  chmodSync(file, 0o600);
}
function command(root: string, vault: PrivacyVault, args: string[]) {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    NODE_ENV: "test",
    REELCHEMY_DATA_DIR: path.join(root, "data"),
    REELCHEMY_AUTH_DIR: path.join(root, "auth"),
    REELCHEMY_ARTIFACT_DIR: path.join(root, "artifacts"),
    REELCHEMY_RENDER_CACHE_DIR: path.join(root, "cache"),
    REELCHEMY_PRIVACY_DIR: vault.directory,
    REELCHEMY_PRIVACY_ID: vault.id,
    REELCHEMY_PRIVACY_KEY_FINGERPRINT: vault.keyFingerprint,
  };
  for (const key of Object.keys(env))
    if (/^(BETTER_AUTH_|SMTP_|AI_|EMAIL_)/.test(key)) delete env[key];
  const result = spawnSync(
    process.execPath,
    ["--import", "tsx", "scripts/privacy-retry.ts", ...args],
    {
      env,
      encoding: "utf8",
      timeout: 15000,
    },
  );
  assert.equal(result.error, undefined);
  assert.equal(result.signal, null);
  return result;
}

test("the real private retry command needs no signing/mail/AI credentials and only requeues the approved account", () =>
  fixture((db, vault, root) => {
    accountStore(root, vault);
    const a = identity(db, 2),
      b = identity(db);
    requestProjectDeletion(db, b.ids[0], b.workspaceId);
    const context = approve(db, vault, a);
    const other = db
      .prepare("SELECT * FROM project_deletions WHERE project_id=?")
      .get(b.ids[0]);
    const beforeTables = db
      .prepare("SELECT name,sql FROM sqlite_master ORDER BY name")
      .all();
    const result = command(root, vault, [
      "--request",
      context.requestId,
      "--limit",
      "1",
    ]);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stderr, "");
    assert.deepEqual(JSON.parse(result.stdout), {
      requestId: context.requestId,
      requeued: 1,
      remainingFailed: 1,
    });
    assert.deepEqual(
      db
        .prepare("SELECT * FROM project_deletions WHERE project_id=?")
        .get(b.ids[0]),
      other,
    );
    assert.deepEqual(
      db.prepare("SELECT name,sql FROM sqlite_master ORDER BY name").all(),
      beforeTables,
    );
    const bad = command(root, vault, [
      "--request",
      context.requestId,
      "--limit",
      "6",
    ]);
    assert.equal(bad.status, 1);
    assert.equal(bad.stdout, "");
    assert(!bad.stderr.includes(a.ownerId));
  }));

test("the real retry command refuses missing or unmigrated studio storage without initializing or repairing it", () => {
  const root = mkdtempSync(
    path.join(tmpdir(), "reelchemy-erasure-retry-preflight-"),
  );
  try {
    const vault = initializePrivacyVault(path.join(root, "privacy"));
    accountStore(root, vault);
    const requestId = randomUUID();
    recordErasureApproval(vault, {
      requestId,
      ownerId: randomUUID(),
      workspaceId: randomUUID(),
      receipt: createErasureReceipt(),
    });
    const args = ["--request", requestId];
    const missing = command(root, vault, args);
    assert.equal(missing.status, 1);
    assert.equal(missing.stdout, "");
    assert.equal(existsSync(path.join(root, "data")), false);
    assert.equal(existsSync(path.join(root, "artifacts")), false);
    mkdirSync(path.join(root, "data"), { mode: 0o700 });
    const file = path.join(root, "data", "studio.sqlite");
    const db = new Database(file);
    db.exec(
      "CREATE TABLE canary(value TEXT);INSERT INTO canary VALUES('untouched');",
    );
    db.close();
    chmodSync(file, 0o600);
    const before = readFileSync(file);
    const unmigrated = command(root, vault, args);
    assert.equal(unmigrated.status, 1);
    assert.equal(unmigrated.stdout, "");
    assert.deepEqual(readFileSync(file), before);
    assert(!existsSync(file + "-wal"));
    assert(!existsSync(path.join(root, "data", "worker.lifecycle.lock")));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("retry refuses foreign/unapproved/completed contexts and invalid bounds without changing tasks", () =>
  fixture((db, vault) => {
    const a = identity(db),
      b = identity(db);
    const context = approve(db, vault, a);
    const before = tasks(db);
    for (const limit of [0, 6, 1.5, NaN])
      assert.throws(
        () => retryErasedProjects(db, vault, context, limit),
        AccountErasureUnavailable,
      );
    for (const input of [
      b,
      { ...context, requestId: randomUUID() },
      { ...context, ownerId: b.ownerId },
      { ...context, workspaceId: b.workspaceId },
    ])
      assert.throws(
        () => retryErasedProjects(db, vault, input),
        AccountErasureConflict,
      );
    advanceErasureState(vault, context.requestId, "requested", "cleaning");
    advanceErasureState(vault, context.requestId, "cleaning", "completed");
    assert.throws(
      () => retryErasedProjects(db, vault, context),
      AccountErasureConflict,
    );
    assert.deepEqual(tasks(db), before);
  }));

test("one corrupt cleanup ownership rolls the whole operator retry batch back", () =>
  fixture((db, vault) => {
    const a = identity(db, 1, ["00000000-0000-4000-8000-000000000001"]),
      b = identity(db, 1, ["00000000-0000-4000-8000-000000000002"]);
    const context = approve(db, vault, a);
    // Model damaged task metadata without changing a project's actual owner or
    // disabling producer barriers. The second task must refuse after the first.
    db.prepare(
      "INSERT INTO project_deletions(project_id,workspace_id,state,requested_at,attempts) VALUES(?,?,'failed',?,3)",
    ).run(b.ids[0], a.workspaceId, new Date().toISOString());
    const before = tasks(db);
    assert.throws(
      () => retryErasedProjects(db, vault, context),
      ProjectDeletionConflict,
    );
    assert.deepEqual(tasks(db), before);
  }));
