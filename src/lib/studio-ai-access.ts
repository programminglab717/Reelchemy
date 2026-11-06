import type Database from "better-sqlite3";
import { providerConfiguration } from "./provider-config";
import { providerBudgetPolicy } from "./provider-budget-policy";
import { ProviderError } from "./provider-error";
import type { ProviderAccess } from "./provider-usage-store";
import type { StudioAiCredentialStore } from "./studio-ai-credentials";

// How a studio reaches an AI director:
// 1. "own": the studio's saved key (Account settings), limited only by the
//    studio's own daily cap and server concurrency.
// 2. "platform": the operator's configured key, available according to
//    REELCHEMY_PLATFORM_AI — "all" (every studio, default), "granted" (only
//    studios with an explicit entitlement, e.g. paying customers) or "off".
//    An entitlement may carry its own daily allowance.
// 3. "demo": the deterministic demo director when neither applies.
export type PlatformAiMode = "all" | "granted" | "off";
export function platformAiMode(
  value = process.env.REELCHEMY_PLATFORM_AI,
): PlatformAiMode {
  const mode = value?.trim().toLowerCase() || "all";
  if (mode === "all" || mode === "granted" || mode === "off") return mode;
  throw new ProviderError("configuration");
}
const usdPattern = /^(0|[1-9]\d{0,6})(?:\.\d{1,6})?$/;
const micro = (value: string) => {
  const [whole, fraction = ""] = value.split(".");
  return Number(BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, "0")));
};
export class StudioAiEntitlementStore {
  constructor(private readonly db: Database.Database) {
    db.transaction(() =>
      db.exec(`CREATE TABLE IF NOT EXISTS studio_ai_entitlements(
        workspace_id TEXT PRIMARY KEY,
        daily_usd TEXT,
        granted_at TEXT NOT NULL,
        reference TEXT);
      CREATE TRIGGER IF NOT EXISTS studio_ai_entitlements_workspace_deleted AFTER DELETE ON workspaces
        BEGIN DELETE FROM studio_ai_entitlements WHERE workspace_id=OLD.id; END;`),
    ).immediate();
  }
  // Operator/billing hook. `dailyUsd` overrides REELCHEMY_AI_STUDIO_USD_PER_DAY
  // for this studio; `reference` is an opaque billing/plan reference.
  grant(workspaceId: string, dailyUsd?: string, reference?: string) {
    if (!/^[A-Za-z0-9_-]{1,80}$/.test(workspaceId))
      throw new Error("Invalid studio ID.");
    if (
      dailyUsd !== undefined &&
      (!usdPattern.test(dailyUsd) || micro(dailyUsd) === 0)
    )
      throw new Error("Daily allowance must be a positive US dollar amount.");
    if (
      reference !== undefined &&
      (reference.length > 200 || /[\x00-\x1f]/.test(reference))
    )
      throw new Error("Invalid reference.");
    if (
      !this.db.prepare("SELECT 1 FROM workspaces WHERE id=?").get(workspaceId)
    )
      throw new Error("Studio not found.");
    this.db
      .prepare(
        `INSERT INTO studio_ai_entitlements(workspace_id,daily_usd,granted_at,reference) VALUES(?,?,?,?)
         ON CONFLICT(workspace_id) DO UPDATE SET daily_usd=excluded.daily_usd,granted_at=excluded.granted_at,reference=excluded.reference`,
      )
      .run(
        workspaceId,
        dailyUsd ?? null,
        new Date().toISOString(),
        reference ?? null,
      );
  }
  revoke(workspaceId: string) {
    return (
      this.db
        .prepare("DELETE FROM studio_ai_entitlements WHERE workspace_id=?")
        .run(workspaceId).changes > 0
    );
  }
  get(workspaceId: string) {
    return this.db
      .prepare(
        "SELECT daily_usd AS dailyUsd,granted_at AS grantedAt,reference FROM studio_ai_entitlements WHERE workspace_id=?",
      )
      .get(workspaceId) as
      | { dailyUsd: string | null; grantedAt: string; reference: string | null }
      | undefined;
  }
  list() {
    return this.db
      .prepare(
        "SELECT workspace_id AS workspaceId,daily_usd AS dailyUsd,granted_at AS grantedAt,reference FROM studio_ai_entitlements ORDER BY granted_at",
      )
      .all();
  }
}
type Configuration = Exclude<
  ReturnType<typeof providerConfiguration>,
  { provider: "mock" }
>;
export type StudioAi =
  | { access: "demo" }
  | {
      access: ProviderAccess;
      configuration: Configuration;
      policy: ReturnType<typeof providerBudgetPolicy>;
    };
// Resolve without contacting a provider. A saved own key always wins, so a
// studio owner can rely on their key even where platform AI is offered.
export function resolveStudioAi(
  workspaceId: string,
  stores: {
    credentials: StudioAiCredentialStore;
    entitlements: StudioAiEntitlementStore;
  },
  secret: () => string,
  env: Record<string, string | undefined> = process.env,
): StudioAi {
  const own = stores.credentials.resolve(workspaceId, secret());
  if (own)
    return {
      access: "own",
      configuration: own.configuration,
      policy: providerBudgetPolicy(env, {
        prices: own.prices,
        studioMicroUsd: own.studioMicroUsd,
      }),
    };
  const configuration = providerConfiguration(env);
  if (configuration.provider === "mock") return { access: "demo" };
  const mode = platformAiMode(env.REELCHEMY_PLATFORM_AI);
  if (mode === "off") return { access: "demo" };
  const entitlement = stores.entitlements.get(workspaceId);
  if (mode === "granted" && !entitlement) return { access: "demo" };
  return {
    access: "platform",
    configuration,
    policy: providerBudgetPolicy(
      env,
      entitlement?.dailyUsd
        ? { studioMicroUsd: micro(entitlement.dailyUsd) }
        : {},
    ),
  };
}
