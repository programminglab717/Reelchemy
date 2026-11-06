import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
process.env.REELCHEMY_DATA_DIR = await mkdtemp(
  path.join(tmpdir(), "reelchemy-studio-ai-"),
);
process.env.REELCHEMY_ARTIFACT_DIR = path.join(
  process.env.REELCHEMY_DATA_DIR,
  "artifacts",
);
const db = await import("../src/lib/db");
const { resolveStudioAi, platformAiMode } =
  await import("../src/lib/studio-ai-access");
const { providerBudgetPolicy } =
  await import("../src/lib/provider-budget-policy");
const { ProviderError } = await import("../src/lib/provider-error");
const { generatePlan } = await import("../src/lib/provider");
const raw = new Database(
  path.join(process.env.REELCHEMY_DATA_DIR, "studio.sqlite"),
);
const secret = "s".repeat(48),
  otherSecret = "t".repeat(48),
  key = "sk-test-private-canary-0123456789ABCD";
const input = {
  provider: "anthropic" as const,
  model: "claude-test-model",
  apiKey: key,
  inputUsdPerMillion: "3",
  outputUsdPerMillion: "15",
  dailyUsd: "5",
};
const stores = {
  credentials: db.studioAiCredentials,
  entitlements: db.studioAiEntitlements,
};
const operator = {
  AI_PROVIDER: "compatible",
  AI_MODEL: "operator-model",
  AI_API_KEY: "operator-key-0000",
  AI_BASE_URL: "https://ai.example.test/v1",
  REELCHEMY_AI_INPUT_USD_PER_MILLION: "1",
  REELCHEMY_AI_OUTPUT_USD_PER_MILLION: "2",
};

test("a saved studio key is encrypted, bound to its studio, never summarised and removed with the studio", () => {
  const studio = db.ensureWorkspace("ai-owner-a", "A").id,
    other = db.ensureWorkspace("ai-owner-b", "B").id;
  const summary = db.studioAiCredentials.save(studio, input, secret);
  assert.equal(summary.keyHint, "ABCD");
  assert(!JSON.stringify(summary).includes(key));
  const row = raw
    .prepare("SELECT * FROM studio_ai_credentials WHERE workspace_id=?")
    .get(studio) as Record<string, string>;
  assert(!JSON.stringify(row).includes(key), "No plaintext key at rest");
  assert.match(row.key_sealed, /^v1\./);
  const resolved = db.studioAiCredentials.resolve(studio, secret)!;
  assert.equal(resolved.configuration.provider, "anthropic");
  assert.equal(
    (resolved.configuration as { key: string }).key,
    key,
    "Decrypts for the owning studio",
  );
  assert.equal(resolved.studioMicroUsd, 5_000_000);
  assert.deepEqual(
    [resolved.prices.input, resolved.prices.output],
    [3_000_000, 15_000_000],
  );
  // A different server secret or a row moved to another studio cannot decrypt.
  assert.throws(
    () => db.studioAiCredentials.resolve(studio, otherSecret),
    /could not be read/,
  );
  raw
    .prepare(
      "INSERT INTO studio_ai_credentials SELECT ?,provider,model,base_url,key_sealed,key_hint,input_usd,output_usd,daily_usd,updated_at FROM studio_ai_credentials WHERE workspace_id=?",
    )
    .run(other, studio);
  assert.throws(
    () => db.studioAiCredentials.resolve(other, secret),
    /could not be read/,
  );
  assert(db.studioAiCredentials.remove(other));
  // Replacing keeps one row; deleting the studio deletes the key.
  db.studioAiCredentials.save(
    studio,
    { ...input, apiKey: `${key}XYZW` },
    secret,
  );
  assert.equal(db.studioAiCredentials.summary(studio)!.keyHint, "XYZW");
  raw.prepare("DELETE FROM workspaces WHERE id=?").run(studio);
  assert.equal(db.studioAiCredentials.summary(studio), undefined);
  assert.equal(
    (
      raw.prepare("SELECT count(*) AS n FROM studio_ai_credentials").get() as {
        n: number;
      }
    ).n,
    0,
  );
});

test("invalid keys, plain-HTTP endpoints and zero prices or limits are refused before storage", () => {
  const studio = db.ensureWorkspace("ai-owner-c", "C").id;
  assert.throws(() =>
    db.studioAiCredentials.save(
      studio,
      { ...input, apiKey: "has space key" },
      secret,
    ),
  );
  assert.throws(
    () =>
      db.studioAiCredentials.save(
        studio,
        {
          ...input,
          provider: "compatible",
          baseUrl: "http://plain.example/v1",
        },
        secret,
      ),
    /HTTPS base URL/,
  );
  assert.throws(
    () =>
      db.studioAiCredentials.save(
        studio,
        { ...input, outputUsdPerMillion: "0" },
        secret,
      ),
    /prices/,
  );
  assert.throws(
    () =>
      db.studioAiCredentials.save(studio, { ...input, dailyUsd: "0" }, secret),
    /daily spending limit/,
  );
  assert.equal(db.studioAiCredentials.summary(studio), undefined);
});

test("own key wins, then platform access by mode and entitlement, otherwise the demo director", () => {
  const studio = db.ensureWorkspace("ai-owner-d", "D").id;
  const env = (mode?: string) => ({
    ...operator,
    ...(mode ? { REELCHEMY_PLATFORM_AI: mode } : {}),
  });
  assert.equal(
    resolveStudioAi(studio, stores, () => secret, {}).access,
    "demo",
  );
  assert.equal(
    resolveStudioAi(studio, stores, () => secret, env()).access,
    "platform",
  );
  assert.equal(
    resolveStudioAi(studio, stores, () => secret, env("off")).access,
    "demo",
  );
  assert.equal(
    resolveStudioAi(studio, stores, () => secret, env("granted")).access,
    "demo",
  );
  db.studioAiEntitlements.grant(studio, "7.5", "plan:test");
  const granted = resolveStudioAi(studio, stores, () => secret, env("granted"));
  if (granted.access === "demo") throw new Error("Expected platform access");
  assert.equal(granted.access, "platform");
  assert.equal(granted.policy.studioMicroUsd, 7_500_000);
  db.studioAiCredentials.save(studio, input, secret);
  const own = resolveStudioAi(studio, stores, () => secret, env("off"));
  if (own.access === "demo") throw new Error("Expected own access");
  assert.equal(own.access, "own");
  assert.equal(own.policy.studioMicroUsd, 5_000_000);
  // Own keys need no operator prices.
  assert.equal(resolveStudioAi(studio, stores, () => secret, {}).access, "own");
  assert(db.studioAiEntitlements.revoke(studio));
  assert.throws(() => platformAiMode("sometimes"), ProviderError);
});

test("own-key spending counts only against the studio's own cap, platform spending against platform allowances", () => {
  const studio = db.ensureWorkspace("ai-owner-e", "E").id,
    other = db.ensureWorkspace("ai-owner-f", "F").id;
  const platform = providerBudgetPolicy({
    ...operator,
    REELCHEMY_AI_GLOBAL_USD_PER_DAY: "0.05",
    REELCHEMY_AI_STUDIO_USD_PER_DAY: "0.05",
    REELCHEMY_AI_CONCURRENT_CALLS: "8",
    REELCHEMY_AI_CALLS_PER_STUDIO: "4",
  });
  const own = providerBudgetPolicy(
    {
      REELCHEMY_AI_GLOBAL_USD_PER_DAY: "0.05",
      REELCHEMY_AI_CONCURRENT_CALLS: "8",
      REELCHEMY_AI_CALLS_PER_STUDIO: "4",
    },
    { prices: platform.prices, studioMicroUsd: 1_000_000 },
  );
  const request = {
    provider: "compatible" as const,
    model: "m",
    payloadBytes: 1000,
  };
  const settle = (id: string) =>
    db.providerUsage.settle(id, {
      input: 1000,
      output: 1000,
      cacheRead: 0,
      cacheWrite: 0,
    });
  // Fill the platform's tiny global allowance with another studio's usage.
  for (;;) {
    try {
      settle(db.providerUsage.reserve(other, request, platform));
    } catch (error) {
      assert(error instanceof ProviderError);
      break;
    }
  }
  assert.throws(
    () => db.providerUsage.reserve(studio, request, platform),
    (error: unknown) =>
      error instanceof ProviderError &&
      ["AI_SERVICE_ALLOWANCE", "AI_STUDIO_ALLOWANCE"].includes(error.code),
  );
  // The same studio can still use its own key; its usage is reported apart.
  const id = db.providerUsage.reserve(studio, request, own, Date.now(), "own");
  settle(id);
  const usage = db.studioAiUsage(studio, "own");
  assert.equal(usage.requests, 1);
  assert.equal(usage.inputTokens, 1000);
  assert.equal(db.studioAiUsage(studio, "platform").requests, 0);
});

test("generation uses the resolved studio configuration and its key, reporting rejected keys clearly", async () => {
  const seen: { url: string; key: string | null }[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    const headers = new Headers(init.headers);
    seen.push({ url: String(url), key: headers.get("x-api-key") });
    return new Response(JSON.stringify({ error: "invalid key" }), {
      status: 401,
    });
  }) as typeof fetch;
  try {
    await assert.rejects(
      generatePlan(
        { prompt: "Bees", duration: 5, format: "landscape" },
        undefined,
        [],
        undefined,
        {
          provider: "anthropic",
          key,
          model: "claude-test-model",
          endpoint: "https://api.anthropic.com/v1/messages",
        },
      ),
      (error: unknown) =>
        error instanceof ProviderError && error.code === "AI_KEY_REJECTED",
    );
  } finally {
    globalThis.fetch = original;
  }
  assert.deepEqual(seen, [
    { url: "https://api.anthropic.com/v1/messages", key },
  ]);
});
