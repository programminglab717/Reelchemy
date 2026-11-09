import { createHash, randomBytes, randomUUID } from "node:crypto";
import type Database from "better-sqlite3";

// Personal access tokens for AI assistants connected over MCP (Claude,
// ChatGPT and other MCP clients). A token acts for one studio: its owner's
// workspace, with the same ownership, validation and limits as the studio
// itself, and only through the MCP endpoint. Only a hash is stored; the
// token is shown once. Tokens go with their workspace.
export const MCP_TOKEN_PREFIX = "rlc_";
export const MAX_MCP_TOKENS = 10;
export type McpTokenSummary = {
  id: string;
  name: string;
  hint: string;
  createdAt: string;
  lastUsedAt: string | null;
  // "token": created in Account settings; "app": connected by OAuth sign-in.
  kind: "token" | "app";
};
type Row = {
  id: string;
  workspace_id: string;
  user_id: string;
  name: string;
  hint: string;
  created_at: string;
  last_used_at: string | null;
  expires_at: string | null;
  refresh_expires_at: string | null;
  client_id: string | null;
};
// OAuth connections: short-lived access tokens with rotating refresh tokens.
export const OAUTH_ACCESS_SECONDS = 3600;
const OAUTH_REFRESH_SECONDS = 30 * 86400;
const MAX_OAUTH_CONNECTIONS = 20;
const hash = (token: string) =>
  createHash("sha256").update(token, "utf8").digest("hex");
export class McpTokenStore {
  constructor(private readonly db: Database.Database) {
    db.transaction(() => {
      db.exec(`CREATE TABLE IF NOT EXISTS mcp_tokens(
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 60),
        token_hash TEXT NOT NULL UNIQUE,
        hint TEXT NOT NULL,
        created_at TEXT NOT NULL,
        last_used_at TEXT);
      CREATE INDEX IF NOT EXISTS mcp_tokens_workspace_idx ON mcp_tokens(workspace_id);
      CREATE TRIGGER IF NOT EXISTS mcp_tokens_workspace_deleted AFTER DELETE ON workspaces
        BEGIN DELETE FROM mcp_tokens WHERE workspace_id=OLD.id; END;`);
      const columns = (
        db.pragma("table_info(mcp_tokens)") as { name: string }[]
      ).map((c) => c.name);
      for (const [name, type] of [
        ["expires_at", "TEXT"],
        ["refresh_hash", "TEXT"],
        ["refresh_expires_at", "TEXT"],
        ["client_id", "TEXT"],
      ])
        if (!columns.includes(name))
          db.exec(`ALTER TABLE mcp_tokens ADD COLUMN ${name} ${type}`);
      db.exec(
        "CREATE UNIQUE INDEX IF NOT EXISTS mcp_tokens_refresh_idx ON mcp_tokens(refresh_hash) WHERE refresh_hash IS NOT NULL",
      );
    }).immediate();
  }
  private issue() {
    const access = MCP_TOKEN_PREFIX + randomBytes(32).toString("base64url");
    const refresh =
      MCP_TOKEN_PREFIX + "r_" + randomBytes(32).toString("base64url");
    const now = Date.now();
    return {
      access,
      refresh,
      expiresAt: new Date(now + OAUTH_ACCESS_SECONDS * 1000).toISOString(),
      refreshExpiresAt: new Date(
        now + OAUTH_REFRESH_SECONDS * 1000,
      ).toISOString(),
    };
  }
  // A connection made by OAuth sign-in. Connecting the same app again
  // replaces its earlier connection.
  connect(workspaceId: string, userId: string, clientId: string, name: string) {
    return this.db
      .transaction(() => {
        this.db
          .prepare(
            "DELETE FROM mcp_tokens WHERE workspace_id=? AND client_id=?",
          )
          .run(workspaceId, clientId);
        const count = (
          this.db
            .prepare(
              "SELECT count(*) AS n FROM mcp_tokens WHERE workspace_id=? AND client_id IS NOT NULL",
            )
            .get(workspaceId) as { n: number }
        ).n;
        if (count >= MAX_OAUTH_CONNECTIONS)
          throw new Error(
            "This studio has too many connected apps. Disconnect one in Account settings.",
          );
        const t = this.issue();
        this.db
          .prepare(
            "INSERT INTO mcp_tokens(id,workspace_id,user_id,name,token_hash,hint,created_at,expires_at,refresh_hash,refresh_expires_at,client_id) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
          )
          .run(
            randomUUID(),
            workspaceId,
            userId,
            name.trim().slice(0, 60) || "Connected app",
            hash(t.access),
            t.access.slice(-4),
            new Date().toISOString(),
            t.expiresAt,
            hash(t.refresh),
            t.refreshExpiresAt,
            clientId,
          );
        return { access: t.access, refresh: t.refresh };
      })
      .immediate();
  }
  // Rotates a connection's tokens; the old refresh token stops working.
  refresh(refreshToken: string, clientId: string) {
    return this.db
      .transaction(() => {
        const row = this.db
          .prepare(
            "SELECT id, refresh_expires_at FROM mcp_tokens WHERE refresh_hash=? AND client_id=?",
          )
          .get(hash(refreshToken), clientId) as
          { id: string; refresh_expires_at: string } | undefined;
        if (!row || Date.parse(row.refresh_expires_at) < Date.now())
          return undefined;
        const t = this.issue();
        this.db
          .prepare(
            "UPDATE mcp_tokens SET token_hash=?, hint=?, expires_at=?, refresh_hash=?, refresh_expires_at=? WHERE id=?",
          )
          .run(
            hash(t.access),
            t.access.slice(-4),
            t.expiresAt,
            hash(t.refresh),
            t.refreshExpiresAt,
            row.id,
          );
        return { access: t.access, refresh: t.refresh };
      })
      .immediate();
  }
  // Creates a token and returns it once, with its summary.
  create(workspaceId: string, userId: string, name: string) {
    const label = name.trim().slice(0, 60) || "AI assistant";
    return this.db
      .transaction(() => {
        const count = (
          this.db
            .prepare(
              "SELECT count(*) AS n FROM mcp_tokens WHERE workspace_id=?",
            )
            .get(workspaceId) as { n: number }
        ).n;
        if (count >= MAX_MCP_TOKENS)
          throw new Error(
            `A studio can have up to ${MAX_MCP_TOKENS} assistant tokens. Revoke one you no longer use.`,
          );
        const token = MCP_TOKEN_PREFIX + randomBytes(32).toString("base64url");
        const id = randomUUID();
        const createdAt = new Date().toISOString();
        this.db
          .prepare(
            "INSERT INTO mcp_tokens(id,workspace_id,user_id,name,token_hash,hint,created_at) VALUES(?,?,?,?,?,?,?)",
          )
          .run(
            id,
            workspaceId,
            userId,
            label,
            hash(token),
            token.slice(-4),
            createdAt,
          );
        return {
          token,
          summary: {
            id,
            name: label,
            hint: token.slice(-4),
            createdAt,
            lastUsedAt: null,
            kind: "token",
          } satisfies McpTokenSummary,
        };
      })
      .immediate();
  }
  list(workspaceId: string): McpTokenSummary[] {
    return (
      this.db
        .prepare(
          "SELECT * FROM mcp_tokens WHERE workspace_id=? ORDER BY created_at DESC",
        )
        .all(workspaceId) as Row[]
    ).map((row) => ({
      id: row.id,
      name: row.name,
      hint: row.hint,
      createdAt: row.created_at,
      lastUsedAt: row.last_used_at,
      kind: row.client_id ? ("app" as const) : ("token" as const),
    }));
  }
  revoke(workspaceId: string, id: string) {
    return (
      this.db
        .prepare("DELETE FROM mcp_tokens WHERE workspace_id=? AND id=?")
        .run(workspaceId, id).changes > 0
    );
  }
  // The studio a presented token acts for, or undefined. The workspace must
  // still belong to the user who created the token.
  resolve(token: string) {
    if (
      !token.startsWith(MCP_TOKEN_PREFIX) ||
      token.length < 40 ||
      token.length > 80
    )
      return undefined;
    const row = this.db
      .prepare(
        `SELECT t.*, w.name AS workspace_name FROM mcp_tokens t
         JOIN workspaces w ON w.id=t.workspace_id AND w.owner_id=t.user_id
         WHERE t.token_hash=?`,
      )
      .get(hash(token)) as (Row & { workspace_name: string }) | undefined;
    if (!row) return undefined;
    // OAuth access tokens expire (their refresh token renews them).
    if (row.expires_at && Date.parse(row.expires_at) < Date.now())
      return undefined;
    // Last use, at most once a minute.
    const now = new Date();
    if (
      !row.last_used_at ||
      now.getTime() - Date.parse(row.last_used_at) > 60000
    )
      this.db
        .prepare("UPDATE mcp_tokens SET last_used_at=? WHERE id=?")
        .run(now.toISOString(), row.id);
    return {
      tokenId: row.id,
      workspaceId: row.workspace_id,
      userId: row.user_id,
      name: row.workspace_name,
    };
  }
}
