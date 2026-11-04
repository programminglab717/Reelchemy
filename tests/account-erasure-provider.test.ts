import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { randomUUID } from "node:crypto";
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
} from "../src/lib/account-erasure-store";
import { detachErasedProviderUsage } from "../src/lib/account-erasure-provider";
import {
  ProviderUsageStore,
  providerUsageSummary,
} from "../src/lib/provider-usage-store";
import {
  providerBudgetPolicy,
  PROVIDER_LEASE_MS,
} from "../src/lib/provider-budget-policy";
import { AccountErasureConflict } from "../src/lib/account-erasure-policy";
const now = 1800000000000;
const policy = providerBudgetPolicy({
  REELCHEMY_AI_INPUT_USD_PER_MILLION: "1",
  REELCHEMY_AI_OUTPUT_USD_PER_MILLION: "2",
});
function fixture(
  run: (
    db: Database.Database,
    vault: PrivacyVault,
    store: ProviderUsageStore,
  ) => void,
) {
  const root = mkdtempSync(path.join(tmpdir(), "reelchemy-erasure-provider-")),
    db = new Database(":memory:");
  try {
    db.exec(
      "CREATE TABLE workspaces(id TEXT PRIMARY KEY,owner_id TEXT UNIQUE,name TEXT);CREATE TABLE projects(id TEXT PRIMARY KEY,workspace_id TEXT,data TEXT,trashed_at TEXT);CREATE TABLE jobs(id TEXT PRIMARY KEY,project_id TEXT,status TEXT,data TEXT,timeline TEXT);CREATE TABLE media_requests(id TEXT PRIMARY KEY,workspace_id TEXT,project_id TEXT,state TEXT,updated_at INTEGER,reserved_bytes INTEGER);",
    );
    const store = new ProviderUsageStore(db);
    migrateAccountErasures(db);
    run(db, initializePrivacyVault(path.join(root, "privacy")), store);
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
}
function identity(db: Database.Database) {
  const input = {
    ownerId: randomUUID(),
    workspaceId: randomUUID(),
    requestId: randomUUID(),
    receipt: createErasureReceipt(),
  };
  db.prepare("INSERT INTO workspaces VALUES(?,?,?)").run(
    input.workspaceId,
    input.ownerId,
    "Synthetic private studio",
  );
  return input;
}
const call = {
  provider: "compatible" as const,
  model: "synthetic-offline",
  payloadBytes: 1000,
};
test("an approved erasure waits for a live provider lease, then detaches ownership without releasing uncertain or known service costs", () =>
  fixture((db, vault, store) => {
    const context = identity(db),
      other = identity(db);
    const known = store.reserve(
      context.workspaceId,
      call,
      policy,
      now - PROVIDER_LEASE_MS - 10,
    );
    store.settle(
      known,
      { input: 200, output: 50, cacheRead: 0, cacheWrite: 0 },
      now,
    );
    const live = store.reserve(context.workspaceId, call, policy, now);
    const settled = store.reserve(other.workspaceId, call, policy, now);
    store.settle(
      settled,
      { input: 100, output: 50, cacheRead: 0, cacheWrite: 0 },
      now,
    );
    recordErasureApproval(vault, context);
    beginStudioErasure(db, vault, context);
    const original = db
      .prepare("SELECT * FROM provider_usage ORDER BY id")
      .all();
    assert.deepEqual(detachErasedProviderUsage(db, vault, context, now), {
      ready: false,
      detached: 0,
    });
    assert.deepEqual(
      db.prepare("SELECT * FROM provider_usage ORDER BY id").all(),
      original,
    );
    const afterLease = now + PROVIDER_LEASE_MS;
    const totalsBefore = providerUsageSummary(db, undefined, afterLease).totals;
    const otherBefore = db
      .prepare("SELECT * FROM provider_usage WHERE workspace_id=?")
      .all(other.workspaceId);
    assert.deepEqual(
      detachErasedProviderUsage(db, vault, context, afterLease),
      { ready: true, detached: 2 },
    );
    assert.deepEqual(
      providerUsageSummary(db, undefined, afterLease).totals,
      totalsBefore,
    );
    assert.deepEqual(
      db
        .prepare("SELECT * FROM provider_usage WHERE workspace_id=?")
        .all(other.workspaceId),
      otherBefore,
    );
    assert.equal(
      (
        db
          .prepare("SELECT count(*) n FROM provider_usage WHERE workspace_id=?")
          .get(context.workspaceId) as { n: number }
      ).n,
      0,
    );
    assert.equal(
      (
        db.prepare("SELECT state FROM provider_usage WHERE id=?").get(live) as {
          state: string;
        }
      ).state,
      "uncertain",
    );
    const rows = db
      .prepare("SELECT * FROM provider_usage ORDER BY id")
      .all() as Record<string, unknown>[];
    for (const before of original as Record<string, unknown>[]) {
      const after = rows.find((row) => row.id === before.id)!;
      for (const key of Object.keys(before))
        if (!["workspace_id", "state", "finished_at"].includes(key))
          assert.deepEqual(after[key], before[key], key);
    }
    assert.deepEqual(
      detachErasedProviderUsage(db, vault, context, afterLease),
      { ready: true, detached: 0 },
    );
    assert(
      store.settle(
        live,
        { input: 10, output: 10, cacheRead: 0, cacheWrite: 0 },
        afterLease + 1,
      ),
      "a late genuine receipt still settles by its original request ID",
    );
    assert.throws(
      () => store.reserve(context.workspaceId, call, policy, afterLease),
      /Account deletion/,
    );
  }));
test("a detached uncertain hold continues to deny a new studio when the shared service budget is full", () =>
  fixture((db, vault, store) => {
    const context = identity(db),
      other = identity(db);
    const id = store.reserve(context.workspaceId, call, policy, now);
    store.uncertain(id, now);
    const held = (
      db
        .prepare("SELECT reserved_micro_usd FROM provider_usage WHERE id=?")
        .get(id) as { reserved_micro_usd: number }
    ).reserved_micro_usd;
    recordErasureApproval(vault, context);
    beginStudioErasure(db, vault, context);
    assert.deepEqual(detachErasedProviderUsage(db, vault, context, now), {
      ready: true,
      detached: 1,
    });
    assert.throws(
      () =>
        store.reserve(
          other.workspaceId,
          call,
          { ...policy, globalMicroUsd: held },
          now,
        ),
      (error: unknown) =>
        error instanceof Error &&
        "code" in error &&
        error.code === "AI_SERVICE_ALLOWANCE",
    );
    assert.equal(
      (
        db.prepare("SELECT count(*) n FROM provider_usage").get() as {
          n: number;
        }
      ).n,
      1,
    );
  }));
test("neither a missing local barrier nor another studio's independent approval can detach provider records", () =>
  fixture((db, vault, store) => {
    const context = identity(db),
      other = identity(db);
    store.reserve(context.workspaceId, call, policy, now);
    recordErasureApproval(vault, context);
    const before = db.prepare("SELECT * FROM provider_usage").all();
    assert.throws(
      () => detachErasedProviderUsage(db, vault, context, now),
      AccountErasureConflict,
    );
    beginStudioErasure(db, vault, context);
    assert.throws(
      () =>
        detachErasedProviderUsage(
          db,
          vault,
          { ...context, workspaceId: other.workspaceId },
          now,
        ),
      AccountErasureConflict,
    );
    assert.deepEqual(db.prepare("SELECT * FROM provider_usage").all(), before);
  }));
