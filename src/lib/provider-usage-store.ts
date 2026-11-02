import type Database from "better-sqlite3";
import { randomUUID, createHash } from "node:crypto";
import { ProviderError } from "./provider-error";
import {
  PROVIDER_LEASE_MS,
  PROVIDER_BUDGET_WINDOW_MS,
  providerReservationCost,
  type ProviderBudgetPolicy,
} from "./provider-budget-policy";
import {
  estimatedMicroUsd,
  type ProviderTokens,
  type ProviderPrices,
} from "./provider-usage";

export type ProviderAccounting = {
  begin(input: {
    provider: "anthropic" | "compatible";
    model: string;
    payloadBytes: number;
  }): { record(tokens: ProviderTokens | undefined): void; uncertain(): void };
};
export class ProviderUsageStore {
  constructor(private readonly db: Database.Database) {
    db.transaction(() => {
      db.exec(`CREATE TABLE IF NOT EXISTS provider_usage(
        id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL,
        provider TEXT NOT NULL, model_hash TEXT NOT NULL,
        created_at INTEGER NOT NULL, finished_at INTEGER,
        state TEXT NOT NULL CHECK(state IN ('reserved','uncertain','settled')),
        reserved_micro_usd INTEGER NOT NULL CHECK(reserved_micro_usd>=0),
        prices TEXT NOT NULL,
        input_tokens INTEGER,output_tokens INTEGER,cache_read_tokens INTEGER,cache_write_tokens INTEGER,
        cost_micro_usd INTEGER CHECK(cost_micro_usd>=0),
        usage_source TEXT CHECK(usage_source IN ('provider','operator'))
      );
      CREATE INDEX IF NOT EXISTS provider_usage_workspace ON provider_usage(workspace_id,created_at);
      CREATE INDEX IF NOT EXISTS provider_usage_state ON provider_usage(state,created_at);`);
    }).immediate();
  }
  reserve(
    workspaceId: string,
    input: {
      provider: "anthropic" | "compatible";
      model: string;
      payloadBytes: number;
    },
    policy: ProviderBudgetPolicy,
    now = Date.now(),
  ) {
    const amount = providerReservationCost(input.payloadBytes, policy);
    if (!workspaceId || !input.model || input.model.length > 200)
      throw new ProviderError("budget-configuration");
    return this.db
      .transaction(() => {
        const count = this.db
          .prepare("SELECT count(*) AS count FROM provider_usage")
          .get() as { count: number };
        if (count.count >= policy.ledgerRequests)
          throw new ProviderError("budget-configuration");
        // A crashed request loses its concurrency slot, never its spending hold.
        this.db
          .prepare(
            "UPDATE provider_usage SET state='uncertain',finished_at=? WHERE state='reserved' AND created_at<=?",
          )
          .run(now, now - PROVIDER_LEASE_MS);
        const rows = this.db
          .prepare(
            `SELECT workspace_id,
        COALESCE(SUM(CASE WHEN state='settled' THEN cost_micro_usd ELSE reserved_micro_usd END),0) AS amount,
        SUM(CASE WHEN state='reserved' THEN 1 ELSE 0 END) AS active
        FROM provider_usage WHERE created_at>? OR state<>'settled' GROUP BY workspace_id`,
          )
          .all(now - PROVIDER_BUDGET_WINDOW_MS) as {
          workspace_id: string;
          amount: number;
          active: number;
        }[];
        let global = 0,
          studio = 0,
          active = 0,
          studioActive = 0;
        for (const row of rows) {
          global += row.amount;
          active += row.active;
          if (row.workspace_id === workspaceId) {
            studio = row.amount;
            studioActive = row.active;
          }
        }
        if (![global, studio, active, studioActive].every(Number.isSafeInteger))
          throw new ProviderError("budget-configuration");
        if (studio + amount > policy.studioMicroUsd)
          throw new ProviderError("studio-budget", 300);
        if (global + amount > policy.globalMicroUsd)
          throw new ProviderError("global-budget", 300);
        if (
          active >= policy.globalConcurrency ||
          studioActive >= policy.studioConcurrency
        )
          throw new ProviderError("budget-capacity", 5);
        const id = randomUUID();
        this.db
          .prepare(
            `INSERT INTO provider_usage(id,workspace_id,provider,model_hash,created_at,state,reserved_micro_usd,prices)
        VALUES(?,?,?,?,?,'reserved',?,?)`,
          )
          .run(
            id,
            workspaceId,
            input.provider,
            createHash("sha256").update(input.model).digest("hex"),
            now,
            amount,
            JSON.stringify(policy.prices),
          );
        return id;
      })
      .immediate();
  }
  settle(id: string, tokens: ProviderTokens, now = Date.now()) {
    return this.db
      .transaction(() => {
        const row = this.db
          .prepare(
            "SELECT prices FROM provider_usage WHERE id=? AND state<>'settled'",
          )
          .get(id) as { prices: string } | undefined;
        if (!row) return false;
        const prices = JSON.parse(row.prices) as ProviderPrices;
        const amount = estimatedMicroUsd(tokens, prices);
        this.db
          .prepare(
            `UPDATE provider_usage SET state='settled',usage_source='provider',finished_at=?,input_tokens=?,output_tokens=?,cache_read_tokens=?,cache_write_tokens=?,cost_micro_usd=? WHERE id=? AND state<>'settled'`,
          )
          .run(
            now,
            tokens.input,
            tokens.output,
            tokens.cacheRead,
            tokens.cacheWrite,
            amount,
            id,
          );
        return true;
      })
      .immediate();
  }
  uncertain(id: string, now = Date.now()) {
    return (
      this.db
        .prepare(
          "UPDATE provider_usage SET state='uncertain',finished_at=? WHERE id=? AND state='reserved'",
        )
        .run(now, id).changes > 0
    );
  }
  reconcile(id: string, confirmedMicroUsd: number, now = Date.now()) {
    if (
      !Number.isSafeInteger(confirmedMicroUsd) ||
      confirmedMicroUsd < 0 ||
      confirmedMicroUsd > 1_000_000_000_000
    )
      throw new ProviderError("budget-configuration");
    // Explicit operator confirmation only. Never overwrite a known receipt or
    // reconcile a request that could still be within its transport deadline.
    return (
      this.db
        .prepare(
          `UPDATE provider_usage SET state='settled',usage_source='operator',finished_at=?,cost_micro_usd=?
      WHERE id=? AND state<>'settled' AND created_at<=?`,
        )
        .run(now, confirmedMicroUsd, id, now - PROVIDER_LEASE_MS).changes > 0
    );
  }
  accounting(
    workspaceId: string,
    policy: ProviderBudgetPolicy,
  ): ProviderAccounting {
    return {
      begin: (input) => {
        let id: string;
        try {
          id = this.reserve(workspaceId, input, policy);
        } catch (error) {
          if (error instanceof ProviderError) throw error;
          throw new ProviderError("budget-configuration");
        }
        let finished = false;
        const complete = (tokens?: ProviderTokens) => {
          if (finished) return;
          try {
            if (tokens) this.settle(id, tokens);
            else this.uncertain(id);
            finished = true;
          } catch {
            // The durable reservation remains charged if recording fails.
            throw new ProviderError("budget-configuration");
          }
        };
        return {
          record: complete,
          uncertain: () => complete(),
        };
      },
    };
  }
}

export function providerUsageSummary(
  db: Database.Database,
  workspaceId?: string,
  now = Date.now(),
) {
  const filter = workspaceId ? " AND workspace_id=?" : "";
  const args = workspaceId ? [workspaceId] : [];
  const totals = db
    .prepare(
      `SELECT count(*) AS retainedRequests,
    COALESCE(SUM(CASE WHEN state='settled' AND created_at>? AND usage_source='provider' THEN cost_micro_usd ELSE 0 END),0) AS providerEstimatedMicroUsd,
    COALESCE(SUM(CASE WHEN state='settled' AND created_at>? AND usage_source='operator' THEN cost_micro_usd ELSE 0 END),0) AS operatorConfirmedMicroUsd,
    COALESCE(SUM(CASE WHEN state<>'settled' THEN reserved_micro_usd ELSE 0 END),0) AS heldMicroUsd,
    COALESCE(SUM(CASE WHEN state='reserved' AND created_at>? THEN 1 ELSE 0 END),0) AS activeRequests,
    COALESCE(SUM(CASE WHEN state='uncertain' OR (state='reserved' AND created_at<=?) THEN 1 ELSE 0 END),0) AS uncertainRequests
    FROM provider_usage WHERE 1=1${filter}`,
    )
    .get(
      now - PROVIDER_BUDGET_WINDOW_MS,
      now - PROVIDER_BUDGET_WINDOW_MS,
      now - PROVIDER_LEASE_MS,
      now - PROVIDER_LEASE_MS,
      ...args,
    );
  const uncertain = db
    .prepare(
      `SELECT id,created_at AS createdAt,reserved_micro_usd AS heldMicroUsd FROM provider_usage
    WHERE state<>'settled' AND created_at<=?${filter} ORDER BY created_at,id LIMIT 20`,
    )
    .all(now - PROVIDER_LEASE_MS, ...args);
  return {
    windowStart: new Date(now - PROVIDER_BUDGET_WINDOW_MS).toISOString(),
    asOf: new Date(now).toISOString(),
    totals,
    uncertain,
  };
}
