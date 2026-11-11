import {
  createHash,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import type Database from "better-sqlite3";

// OAuth 2.1 for the MCP endpoint, as MCP clients expect (claude.ai and
// ChatGPT connectors): dynamically registered public clients, PKCE (S256)
// authorization codes approved by the signed-in owner, then access and
// refresh tokens held by McpTokenStore. Codes are single-use and short-lived;
// only hashes are stored.
export const OAUTH_SCOPE = "studio";
const CODE_SECONDS = 300;
const MAX_CLIENTS = 1000;
// Registration needs no sign-in (clients register before their user
// approves anything), so it is bounded: a few per hour, and registrations
// that never led to a connection are forgotten after a day.
const REGISTRATIONS_PER_HOUR = 30;
const UNUSED_CLIENT_MS = 86400000;
export class RegistrationBusy extends Error {
  constructor() {
    super("Too many apps registered recently. Try again in an hour.");
  }
}
export type OAuthClient = {
  id: string;
  name: string;
  redirectUris: string[];
};
const sha = (value: string) =>
  createHash("sha256").update(value, "utf8").digest();
// Redirect URIs: HTTPS, or HTTP on the loopback address (desktop clients).
export function validRedirectUri(uri: string) {
  if (uri.length > 500) return false;
  let url: URL;
  try {
    url = new URL(uri);
  } catch {
    return false;
  }
  if (url.hash) return false;
  if (url.protocol === "https:") return true;
  return (
    url.protocol === "http:" &&
    ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
  );
}
export function pkceMatches(verifier: string, challenge: string) {
  if (!/^[A-Za-z0-9._~-]{43,128}$/.test(verifier)) return false;
  const expected = Buffer.from(challenge, "utf8");
  const actual = Buffer.from(sha(verifier).toString("base64url"), "utf8");
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
export class McpOAuthStore {
  constructor(private readonly db: Database.Database) {
    db.transaction(() =>
      db.exec(`CREATE TABLE IF NOT EXISTS oauth_clients(
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        redirect_uris TEXT NOT NULL,
        created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS oauth_codes(
        code_hash TEXT PRIMARY KEY,
        client_id TEXT NOT NULL,
        workspace_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        redirect_uri TEXT NOT NULL,
        challenge TEXT NOT NULL,
        expires_at INTEGER NOT NULL);
      CREATE TRIGGER IF NOT EXISTS oauth_codes_workspace_deleted AFTER DELETE ON workspaces
        BEGIN DELETE FROM oauth_codes WHERE workspace_id=OLD.id; END;`),
    ).immediate();
  }
  register(name: string, redirectUris: string[]): OAuthClient {
    const uris = [...new Set(redirectUris)];
    if (!uris.length || uris.length > 5 || !uris.every(validRedirectUri))
      throw new Error(
        "Register one to five redirect URIs (HTTPS, or HTTP on localhost).",
      );
    return this.db
      .transaction(() => {
        const now = Date.now();
        this.db
          .prepare(
            `DELETE FROM oauth_clients WHERE created_at<?
               AND id NOT IN (SELECT client_id FROM mcp_tokens WHERE client_id IS NOT NULL)
               AND id NOT IN (SELECT client_id FROM oauth_codes)`,
          )
          .run(new Date(now - UNUSED_CLIENT_MS).toISOString());
        const counted = (since: string) =>
          (
            this.db
              .prepare(
                "SELECT count(*) AS n FROM oauth_clients WHERE created_at>=?",
              )
              .get(since) as { n: number }
          ).n;
        if (
          counted(new Date(now - 3600000).toISOString()) >=
          REGISTRATIONS_PER_HOUR
        )
          throw new RegistrationBusy();
        if (counted("") >= MAX_CLIENTS)
          throw new Error("This studio cannot register more apps.");
        const client = {
          id: randomUUID(),
          name: name.trim().slice(0, 60) || "MCP client",
          redirectUris: uris,
        };
        this.db
          .prepare(
            "INSERT INTO oauth_clients(id,name,redirect_uris,created_at) VALUES(?,?,?,?)",
          )
          .run(
            client.id,
            client.name,
            JSON.stringify(uris),
            new Date().toISOString(),
          );
        return client;
      })
      .immediate();
  }
  client(id: string): OAuthClient | undefined {
    const row = this.db
      .prepare("SELECT * FROM oauth_clients WHERE id=?")
      .get(id) as
      { id: string; name: string; redirect_uris: string } | undefined;
    return row
      ? {
          id: row.id,
          name: row.name,
          redirectUris: JSON.parse(row.redirect_uris),
        }
      : undefined;
  }
  // A code the owner approved, for one client, redirect URI and challenge.
  issueCode(input: {
    clientId: string;
    workspaceId: string;
    userId: string;
    redirectUri: string;
    challenge: string;
  }) {
    const code = randomBytes(32).toString("base64url");
    this.db
      .prepare("DELETE FROM oauth_codes WHERE expires_at<?")
      .run(Date.now());
    this.db
      .prepare(
        "INSERT INTO oauth_codes(code_hash,client_id,workspace_id,user_id,redirect_uri,challenge,expires_at) VALUES(?,?,?,?,?,?,?)",
      )
      .run(
        sha(code).toString("hex"),
        input.clientId,
        input.workspaceId,
        input.userId,
        input.redirectUri,
        input.challenge,
        Date.now() + CODE_SECONDS * 1000,
      );
    return code;
  }
  // Consumes a code (once) when the client, redirect URI and PKCE verifier
  // match; any mismatch also burns the code.
  redeem(input: {
    code: string;
    clientId: string;
    redirectUri: string;
    verifier: string;
  }) {
    return this.db
      .transaction(() => {
        const key = sha(input.code).toString("hex");
        const row = this.db
          .prepare("SELECT * FROM oauth_codes WHERE code_hash=?")
          .get(key) as
          | {
              client_id: string;
              workspace_id: string;
              user_id: string;
              redirect_uri: string;
              challenge: string;
              expires_at: number;
            }
          | undefined;
        if (!row) return undefined;
        this.db.prepare("DELETE FROM oauth_codes WHERE code_hash=?").run(key);
        if (
          row.expires_at < Date.now() ||
          row.client_id !== input.clientId ||
          row.redirect_uri !== input.redirectUri ||
          !pkceMatches(input.verifier, row.challenge)
        )
          return undefined;
        return { workspaceId: row.workspace_id, userId: row.user_id };
      })
      .immediate();
  }
}
