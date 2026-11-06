import type Database from "better-sqlite3";
import {
  createCipheriv,
  createDecipheriv,
  hkdfSync,
  randomBytes,
} from "node:crypto";
import { z } from "zod";
import { providerConfiguration } from "./provider-config";
import { ProviderError } from "./provider-error";
import type { ProviderPrices } from "./provider-usage";

// A studio owner's own AI provider key, saved from Account settings. The key
// is encrypted at rest with AES-256-GCM under a key derived from the server's
// authentication signing secret and bound to the studio, so a copied row
// cannot be read without that secret or moved to another studio. Only the
// last four characters are kept in plain text for recognition. The key is
// never returned to browsers, logged or passed to render/ingest workers.
const usd = z
  .string()
  .trim()
  .regex(/^(0|[1-9]\d{0,6})(?:\.\d{1,6})?$/, "Use a decimal US dollar amount.");
export const studioAiCredentialInput = z
  .object({
    provider: z.enum(["anthropic", "compatible"]),
    model: z
      .string()
      .trim()
      .min(1)
      .max(200)
      .regex(/^[\x21-\x7e]+$/, "Use the provider's model identifier."),
    baseUrl: z.string().trim().max(2048).optional().default(""),
    apiKey: z
      .string()
      .trim()
      .min(8, "Paste the complete API key.")
      .max(4096)
      .regex(/^[\x21-\x7e]+$/, "API keys contain no spaces."),
    inputUsdPerMillion: usd,
    outputUsdPerMillion: usd,
    dailyUsd: usd,
  })
  .strict();
export type StudioAiCredentialInput = z.input<typeof studioAiCredentialInput>;
export type StudioAiCredentialSummary = {
  configured: true;
  provider: "anthropic" | "compatible";
  model: string;
  baseUrl: string;
  keyHint: string;
  inputUsdPerMillion: string;
  outputUsdPerMillion: string;
  dailyUsd: string;
  updatedAt: string;
};
export class StudioAiCredentialUnavailable extends Error {
  constructor() {
    super(
      "Your saved AI provider key could not be read. Delete it and save it again.",
    );
  }
}
const micro = (value: string) => {
  const [whole, fraction = ""] = value.split(".");
  return Number(BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, "0")));
};
function dataKey(secret: string) {
  if (!secret || secret.length < 32) throw new StudioAiCredentialUnavailable();
  return Buffer.from(
    hkdfSync(
      "sha256",
      Buffer.from(secret, "utf8"),
      Buffer.from("reelchemy-studio-ai-credential", "utf8"),
      Buffer.from("aes-256-gcm-v1", "utf8"),
      32,
    ),
  );
}
const aad = (workspaceId: string) =>
  Buffer.from(`studio-ai-credential:v1:${workspaceId}`, "utf8");
function seal(secret: string, workspaceId: string, plaintext: string) {
  const iv = randomBytes(12),
    cipher = createCipheriv("aes-256-gcm", dataKey(secret), iv);
  cipher.setAAD(aad(workspaceId));
  const body = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  return `v1.${iv.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}.${body.toString("base64url")}`;
}
function open(secret: string, workspaceId: string, sealed: string) {
  const [version, iv, tag, body] = sealed.split(".");
  if (version !== "v1" || !iv || !tag || !body)
    throw new StudioAiCredentialUnavailable();
  try {
    const decipher = createDecipheriv(
      "aes-256-gcm",
      dataKey(secret),
      Buffer.from(iv, "base64url"),
    );
    decipher.setAAD(aad(workspaceId));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([
      decipher.update(Buffer.from(body, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    throw new StudioAiCredentialUnavailable();
  }
}
type Row = {
  provider: "anthropic" | "compatible";
  model: string;
  base_url: string;
  key_sealed: string;
  key_hint: string;
  input_usd: string;
  output_usd: string;
  daily_usd: string;
  updated_at: string;
};
export class StudioAiCredentialStore {
  constructor(private readonly db: Database.Database) {
    db.transaction(() =>
      db.exec(`CREATE TABLE IF NOT EXISTS studio_ai_credentials(
        workspace_id TEXT PRIMARY KEY,
        provider TEXT NOT NULL CHECK(provider IN ('anthropic','compatible')),
        model TEXT NOT NULL, base_url TEXT NOT NULL,
        key_sealed TEXT NOT NULL, key_hint TEXT NOT NULL,
        input_usd TEXT NOT NULL, output_usd TEXT NOT NULL, daily_usd TEXT NOT NULL,
        updated_at TEXT NOT NULL);
      CREATE TRIGGER IF NOT EXISTS studio_ai_credentials_workspace_deleted AFTER DELETE ON workspaces
        BEGIN DELETE FROM studio_ai_credentials WHERE workspace_id=OLD.id; END;`),
    ).immediate();
  }
  // Validates the provider endpoint/model/key with the same rules as operator
  // configuration before anything is stored.
  save(workspaceId: string, input: StudioAiCredentialInput, secret: string) {
    const value = studioAiCredentialInput.parse(input);
    try {
      providerConfiguration({
        AI_PROVIDER: value.provider,
        AI_MODEL: value.model,
        AI_API_KEY: value.apiKey,
        AI_BASE_URL: value.baseUrl || undefined,
      });
    } catch {
      throw new Error(
        value.provider === "compatible"
          ? "Use an HTTPS base URL for your OpenAI-compatible provider (for example https://api.openai.com/v1)."
          : "Check the model identifier and base URL.",
      );
    }
    if (
      micro(value.inputUsdPerMillion) === 0 ||
      micro(value.outputUsdPerMillion) === 0
    )
      throw new Error(
        "Enter the model's input and output prices per million tokens.",
      );
    if (micro(value.dailyUsd) === 0 || micro(value.dailyUsd) > 1_000_000_000)
      throw new Error(
        "Choose a daily spending limit between $0.000001 and $1,000.",
      );
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO studio_ai_credentials(workspace_id,provider,model,base_url,key_sealed,key_hint,input_usd,output_usd,daily_usd,updated_at)
         VALUES(?,?,?,?,?,?,?,?,?,?)
         ON CONFLICT(workspace_id) DO UPDATE SET provider=excluded.provider,model=excluded.model,base_url=excluded.base_url,
           key_sealed=excluded.key_sealed,key_hint=excluded.key_hint,input_usd=excluded.input_usd,output_usd=excluded.output_usd,
           daily_usd=excluded.daily_usd,updated_at=excluded.updated_at`,
      )
      .run(
        workspaceId,
        value.provider,
        value.model,
        value.baseUrl,
        seal(secret, workspaceId, value.apiKey),
        value.apiKey.slice(-4),
        value.inputUsdPerMillion,
        value.outputUsdPerMillion,
        value.dailyUsd,
        now,
      );
    return this.summary(workspaceId)!;
  }
  summary(workspaceId: string): StudioAiCredentialSummary | undefined {
    const row = this.row(workspaceId);
    return row
      ? {
          configured: true,
          provider: row.provider,
          model: row.model,
          baseUrl: row.base_url,
          keyHint: row.key_hint,
          inputUsdPerMillion: row.input_usd,
          outputUsdPerMillion: row.output_usd,
          dailyUsd: row.daily_usd,
          updatedAt: row.updated_at,
        }
      : undefined;
  }
  remove(workspaceId: string) {
    return (
      this.db
        .prepare("DELETE FROM studio_ai_credentials WHERE workspace_id=?")
        .run(workspaceId).changes > 0
    );
  }
  // Provider configuration plus the studio's own budget, or undefined when
  // the studio has not saved a key (operator configuration then applies).
  resolve(workspaceId: string, secret: string) {
    const row = this.row(workspaceId);
    if (!row) return undefined;
    const apiKey = open(secret, workspaceId, row.key_sealed);
    let configuration;
    try {
      configuration = providerConfiguration({
        AI_PROVIDER: row.provider,
        AI_MODEL: row.model,
        AI_API_KEY: apiKey,
        AI_BASE_URL: row.base_url || undefined,
      });
    } catch {
      throw new ProviderError("configuration");
    }
    if (configuration.provider === "mock")
      throw new ProviderError("configuration");
    const input = micro(row.input_usd);
    const prices: ProviderPrices = {
      input,
      output: micro(row.output_usd),
      cacheRead: input,
      cacheWrite: input * 2,
    };
    return {
      configuration,
      prices,
      studioMicroUsd: micro(row.daily_usd),
    };
  }
  private row(workspaceId: string) {
    return this.db
      .prepare(
        "SELECT provider,model,base_url,key_sealed,key_hint,input_usd,output_usd,daily_usd,updated_at FROM studio_ai_credentials WHERE workspace_id=?",
      )
      .get(workspaceId) as Row | undefined;
  }
}
