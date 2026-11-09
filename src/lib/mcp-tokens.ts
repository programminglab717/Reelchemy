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
};
type Row = {
  id: string;
  workspace_id: string;
  user_id: string;
  name: string;
  hint: string;
  created_at: string;
  last_used_at: string | null;
};
const hash = (token: string) =>
  createHash("sha256").update(token, "utf8").digest("hex");
export class McpTokenStore {
  constructor(private readonly db: Database.Database) {
    db.transaction(() =>
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
        BEGIN DELETE FROM mcp_tokens WHERE workspace_id=OLD.id; END;`),
    ).immediate();
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
