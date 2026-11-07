import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { providerTokens, estimatedMicroUsd } from "../src/lib/provider-usage";
import {
  providerBudgetPolicy,
  providerReservationCost,
  PROVIDER_BUDGET_WINDOW_MS,
  PROVIDER_LEASE_MS,
} from "../src/lib/provider-budget-policy";
import {
  ProviderUsageStore,
  providerUsageSummary,
} from "../src/lib/provider-usage-store";
import { ProviderError } from "../src/lib/provider-error";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { Worker } from "node:worker_threads";
import { once } from "node:events";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";

const prices = {
  REELCHEMY_AI_INPUT_USD_PER_MILLION: "3",
  REELCHEMY_AI_OUTPUT_USD_PER_MILLION: "15",
  REELCHEMY_AI_CACHE_READ_USD_PER_MILLION: "0.3",
  REELCHEMY_AI_CACHE_WRITE_USD_PER_MILLION: "6",
};
const policy = providerBudgetPolicy(prices);
const call = {
  provider: "compatible" as const,
  model: "offline-model",
  payloadBytes: 10_000,
};
const tokens = { input: 1000, output: 200, cacheRead: 100, cacheWrite: 0 };
function fixture() {
  const db = new Database(":memory:");
  return { db, store: new ProviderUsageStore(db) };
}
function code(expected: string) {
  return (error: unknown) =>
    error instanceof ProviderError && error.code === expected;
}

test("provider usage separates cached tokens and refuses incomplete, malformed or inconsistent reports", () => {
  assert.deepEqual(
    providerTokens("compatible", {
      usage: {
        prompt_tokens: 1100,
        completion_tokens: 200,
        total_tokens: 1300,
        prompt_tokens_details: { cached_tokens: 100 },
      },
    }),
    tokens,
  );
  assert.deepEqual(
    providerTokens("anthropic", {
      usage: {
        input_tokens: 1000,
        output_tokens: 200,
        cache_read_input_tokens: 100,
        cache_creation_input_tokens: 40,
      },
    }),
    { ...tokens, cacheWrite: 40 },
  );
  for (const usage of [
    null,
    {},
    { prompt_tokens: 100 },
    { prompt_tokens: 100, completion_tokens: -1 },
    { prompt_tokens: "100", completion_tokens: 2 },
    { prompt_tokens: 100.5, completion_tokens: 2 },
    { prompt_tokens: 100, completion_tokens: 2, total_tokens: 999 },
    {
      prompt_tokens: 100,
      completion_tokens: 2,
      prompt_tokens_details: { cached_tokens: 101 },
    },
    {
      prompt_tokens: 100,
      completion_tokens: 2,
      prompt_tokens_details: "invalid",
    },
    { prompt_tokens: Infinity, completion_tokens: 2 },
  ])
    assert.equal(providerTokens("compatible", { usage }), undefined);
  assert.equal(
    providerTokens("anthropic", {
      usage: {
        input_tokens: 100,
        output_tokens: 2,
        cache_creation_input_tokens: -1,
      },
    }),
    undefined,
  );
  assert.equal(
    providerTokens("anthropic", {
      usage: {
        input_tokens: 100_000_000,
        output_tokens: 2,
        cache_read_input_tokens: 1,
      },
    }),
    undefined,
  );
});

test("configured-price estimates use exact integer arithmetic and round up once, including fractional-dollar rates", () => {
  assert.equal(estimatedMicroUsd(tokens, policy.prices), 6030);
  assert.equal(
    estimatedMicroUsd(
      { input: 1, output: 1, cacheRead: 1, cacheWrite: 1 },
      { input: 1, output: 1, cacheRead: 1, cacheWrite: 1 },
    ),
    1,
  );
  const tiny = providerBudgetPolicy({
    ...prices,
    REELCHEMY_AI_INPUT_USD_PER_MILLION: "0.000001",
  });
  assert.equal(tiny.prices.input, 1);
  assert.equal(
    estimatedMicroUsd(
      { input: 100_000_000, output: 100_000_000, cacheRead: 0, cacheWrite: 0 },
      {
        input: 1_000_000_000_000,
        output: 1_000_000_000_000,
        cacheRead: 0,
        cacheWrite: 0,
      },
    ),
    200_000_000_000_000,
  );
  assert.throws(() =>
    estimatedMicroUsd({ ...tokens, input: NaN }, policy.prices),
  );
});

test("live pricing, budget and input configuration fail closed, with explicit zero service allowance supported", () => {
  assert.throws(
    () => providerBudgetPolicy({}),
    code("AI_BUDGET_CONFIGURATION"),
  );
  for (const value of ["-1", "1e2", " 3", "3 ", "NaN", "0.1234567", "1000001"])
    assert.throws(
      () =>
        providerBudgetPolicy({
          ...prices,
          REELCHEMY_AI_GLOBAL_USD_PER_DAY: value,
        }),
      code("AI_BUDGET_CONFIGURATION"),
    );
  assert.equal(
    providerBudgetPolicy({ ...prices, REELCHEMY_AI_GLOBAL_USD_PER_DAY: "0" })
      .globalMicroUsd,
    0,
  );
  assert.throws(
    () =>
      providerBudgetPolicy({ ...prices, REELCHEMY_AI_CONCURRENT_CALLS: "0" }),
    code("AI_BUDGET_CONFIGURATION"),
  );
  assert.throws(
    () => providerReservationCost(policy.payloadBytes + 1, policy),
    code("AI_REQUEST_SIZE"),
  );
});

test("atomic admission counts all workspaces and enforces studio/global concurrency without persisting refused calls", () => {
  const { db, store } = fixture();
  // Two calls at once across the service, one per studio.
  const policy = providerBudgetPolicy({
    ...prices,
    REELCHEMY_AI_CONCURRENT_CALLS: "2",
  });
  try {
    const first = store.reserve("a", call, policy, 1000);
    assert.throws(
      () => store.reserve("a", call, policy, 1001),
      code("AI_BUSY"),
    );
    const second = store.reserve("b", call, policy, 1001);
    assert.throws(
      () => store.reserve("c", call, policy, 1002),
      code("AI_BUSY"),
    );
    assert.equal(
      (
        db.prepare("SELECT count(*) AS n FROM provider_usage").get() as {
          n: number;
        }
      ).n,
      2,
    );
    store.settle(first, tokens, 1100);
    assert.ok(store.reserve("c", call, policy, 1101));
    assert.equal(store.uncertain(second, 1102), true);
    assert.equal(store.uncertain(second, 1103), false);
  } finally {
    db.close();
  }
});

test("spending holds survive uncertainty and rollover while settled historic charges leave the rolling window", () => {
  const { db, store } = fixture(),
    amount = providerReservationCost(call.payloadBytes, policy);
  const bounded = {
    ...policy,
    studioMicroUsd: amount,
    globalMicroUsd: amount * 2,
  };
  try {
    const first = store.reserve("a", call, bounded, 1000);
    store.uncertain(first, 1001);
    assert.throws(
      () => store.reserve("a", call, bounded, PROVIDER_BUDGET_WINDOW_MS + 2000),
      code("AI_STUDIO_ALLOWANCE"),
    );
    const second = store.reserve(
      "b",
      call,
      bounded,
      PROVIDER_BUDGET_WINDOW_MS + 2000,
    );
    store.uncertain(second, PROVIDER_BUDGET_WINDOW_MS + 2001);
    assert.throws(
      () => store.reserve("c", call, bounded, PROVIDER_BUDGET_WINDOW_MS + 2002),
      code("AI_SERVICE_ALLOWANCE"),
    );
    // A late known receipt replaces its original hold using original prices.
    assert.equal(
      store.settle(first, tokens, PROVIDER_BUDGET_WINDOW_MS + 2003),
      true,
    );
    assert.ok(
      store.reserve("a", call, bounded, PROVIDER_BUDGET_WINDOW_MS + 2004),
    );
  } finally {
    db.close();
  }
});

test("stale calls release only concurrency, and settlement is immutable even when actual estimates exceed their hold", () => {
  const { db, store } = fixture();
  try {
    const first = store.reserve("a", call, policy, 1000);
    const second = store.reserve("a", call, policy, 1000 + PROVIDER_LEASE_MS);
    assert.notEqual(first, second);
    assert.equal(
      (
        db
          .prepare("SELECT state FROM provider_usage WHERE id=?")
          .get(first) as { state: string }
      ).state,
      "uncertain",
    );
    const expensive = { ...tokens, input: 1_000_000 };
    assert.equal(
      store.settle(first, expensive, 1001 + PROVIDER_LEASE_MS),
      true,
    );
    assert.equal(store.settle(first, tokens, 1002 + PROVIDER_LEASE_MS), false);
    const row = db
      .prepare(
        "SELECT cost_micro_usd,reserved_micro_usd FROM provider_usage WHERE id=?",
      )
      .get(first) as { cost_micro_usd: number; reserved_micro_usd: number };
    assert.equal(
      row.cost_micro_usd,
      estimatedMicroUsd(expensive, policy.prices),
    );
    assert.ok(row.cost_micro_usd > row.reserved_micro_usd);
    assert.throws(
      () => store.reserve("a", call, policy, 1003 + PROVIDER_LEASE_MS),
      code("AI_STUDIO_ALLOWANCE"),
    );
  } finally {
    db.close();
  }
});

test("accounting records each request once, snapshots rates and converts persistence failures to fixed safe errors", () => {
  const { db, store } = fixture();
  const mutable = structuredClone(policy);
  const lease = store.accounting("private-workspace", mutable).begin(call);
  mutable.prices.input = 999_999;
  lease.record(tokens);
  lease.uncertain();
  lease.record({ ...tokens, input: 9_000_000 });
  assert.deepEqual(
    db.prepare("SELECT state,cost_micro_usd FROM provider_usage").get(),
    {
      state: "settled",
      cost_micro_usd: estimatedMicroUsd(tokens, policy.prices),
    },
  );
  db.close();
  assert.throws(
    () => store.accounting("a", policy).begin(call),
    code("AI_BUDGET_CONFIGURATION"),
  );
});

test("ledger capacity refuses new calls without deleting receipts, and zero prices cannot silently disable metering", () => {
  assert.throws(
    () =>
      providerBudgetPolicy({
        ...prices,
        REELCHEMY_AI_INPUT_USD_PER_MILLION: "0",
      }),
    code("AI_BUDGET_CONFIGURATION"),
  );
  const { db, store } = fixture();
  try {
    const bounded = { ...policy, ledgerRequests: 1 };
    const id = store.reserve("a", call, bounded, 1000);
    store.settle(id, tokens, 1001);
    assert.throws(
      () => store.reserve("b", call, bounded, 1002),
      code("AI_BUDGET_CONFIGURATION"),
    );
    assert.equal(
      (
        db.prepare("SELECT count(*) AS n FROM provider_usage").get() as {
          n: number;
        }
      ).n,
      1,
    );
  } finally {
    db.close();
  }
});

test("operator reconciliation requires an unresolved expired call and keeps reported estimates distinct from confirmed charges", () => {
  const { db, store } = fixture();
  try {
    const now = 1_000_000;
    const known = store.reserve("a", call, policy, now);
    store.settle(known, tokens, now + 1);
    assert.equal(store.reconcile(known, 0, now + PROVIDER_LEASE_MS), false);
    const unknown = store.reserve("a", call, policy, now + 2);
    store.uncertain(unknown, now + 3);
    assert.equal(store.reconcile(unknown, 12345, now + 4), false);
    assert.equal(
      store.reconcile(unknown, 12345, now + PROVIDER_LEASE_MS + 3),
      true,
    );
    assert.equal(
      store.reconcile(unknown, 0, now + PROVIDER_LEASE_MS + 4),
      false,
    );
    assert.equal(
      store.settle(unknown, tokens, now + PROVIDER_LEASE_MS + 5),
      false,
    );
    const privateHold = store.reserve(
      "b",
      call,
      policy,
      now + PROVIDER_LEASE_MS + 6,
    );
    store.uncertain(privateHold, now + PROVIDER_LEASE_MS + 7);
    const before = JSON.stringify(
      db.prepare("SELECT * FROM provider_usage ORDER BY id").all(),
    );
    const summary = providerUsageSummary(db, "a", now + PROVIDER_LEASE_MS + 10);
    assert.deepEqual(summary.totals, {
      retainedRequests: 2,
      providerEstimatedMicroUsd: 6030,
      operatorConfirmedMicroUsd: 12345,
      heldMicroUsd: 0,
      activeRequests: 0,
      uncertainRequests: 0,
    });
    assert.deepEqual(summary.uncertain, []);
    assert.ok(!JSON.stringify(summary).includes(privateHold));
    assert.equal(
      JSON.stringify(
        db.prepare("SELECT * FROM provider_usage ORDER BY id").all(),
      ),
      before,
    );
  } finally {
    db.close();
  }
});

test("independent simultaneous SQLite writers cannot overspend the global or studio allowance", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "reelchemy-provider-race-"));
  const amount = providerReservationCost(call.payloadBytes, policy);
  try {
    for (const scope of ["global", "studio"] as const) {
      const file = path.join(root, `${scope}.sqlite`),
        db = new Database(file);
      db.pragma("journal_mode = WAL");
      new ProviderUsageStore(db);
      const gate = new SharedArrayBuffer(4);
      const bounded = {
        ...policy,
        globalMicroUsd: amount * (scope === "global" ? 1 : 2),
        studioMicroUsd: amount,
      };
      const workers = ["a", scope === "global" ? "b" : "a"].map(
        (workspace) =>
          new Worker(
            new URL("./helpers/provider-admission.mjs", import.meta.url),
            {
              workerData: {
                file,
                gate,
                workspace,
                input: call,
                policy: bounded,
              },
            },
          ),
      );
      try {
        await Promise.all(workers.map((worker) => once(worker, "message")));
        const outcomes = workers.map((worker) => once(worker, "message"));
        Atomics.store(new Int32Array(gate), 0, 1);
        Atomics.notify(new Int32Array(gate), 0, 2);
        const results = (await Promise.all(outcomes)).map(([result]) => result);
        assert.equal(
          results.filter((result) => typeof result.id === "string").length,
          1,
        );
        assert.deepEqual(
          results.filter((result) => result.code).map((result) => result.code),
          [scope === "global" ? "AI_SERVICE_ALLOWANCE" : "AI_STUDIO_ALLOWANCE"],
        );
        assert.deepEqual(
          db
            .prepare(
              "SELECT count(*) AS n,sum(reserved_micro_usd) AS held FROM provider_usage",
            )
            .get(),
          { n: 1, held: amount },
        );
      } finally {
        await Promise.allSettled(workers.map((worker) => worker.terminate()));
        db.close();
      }
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("operator CLIs read without migration or mutation and explicitly reconcile only an expired unresolved receipt", () => {
  const root = mkdtempSync(path.join(tmpdir(), "reelchemy-provider-cli-"));
  const file = path.join(root, "studio.sqlite"),
    db = new Database(file);
  try {
    const store = new ProviderUsageStore(db),
      id = store.reserve(
        "a",
        call,
        policy,
        Date.now() - PROVIDER_LEASE_MS - 1000,
      );
    store.uncertain(id);
    const env: NodeJS.ProcessEnv = {
      NODE_ENV: "test",
      PATH: process.env.PATH,
      REELCHEMY_DATA_DIR: root,
    };
    const hash = () =>
      createHash("sha256").update(readFileSync(file)).digest("hex");
    const before = hash();
    const output = execFileSync(
      process.execPath,
      ["--import", "tsx", "scripts/ai-usage.ts", "--workspace", "a"],
      { env, encoding: "utf8", timeout: 20000 },
    );
    assert.equal(hash(), before);
    const report = JSON.parse(output);
    assert.equal(report.totals.uncertainRequests, 1);
    assert.equal(report.uncertain[0].id, id);
    execFileSync(
      process.execPath,
      [
        "--import",
        "tsx",
        "scripts/ai-reconcile.ts",
        "--request",
        id,
        "--confirmed-usd",
        "0",
      ],
      { env, timeout: 20000 },
    );
    assert.deepEqual(
      db
        .prepare("SELECT state,cost_micro_usd,usage_source FROM provider_usage")
        .get(),
      { state: "settled", cost_micro_usd: 0, usage_source: "operator" },
    );
    assert.throws(() =>
      execFileSync(
        process.execPath,
        [
          "--import",
          "tsx",
          "scripts/ai-reconcile.ts",
          "--request",
          id,
          "--confirmed-usd",
          "1",
        ],
        { env, timeout: 20000, stdio: "pipe" },
      ),
    );
    assert.equal(
      (
        db.prepare("SELECT cost_micro_usd FROM provider_usage").get() as {
          cost_micro_usd: number;
        }
      ).cost_micro_usd,
      0,
    );
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});
