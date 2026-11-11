import { createHash, randomBytes } from "node:crypto";
import type Database from "better-sqlite3";

// Links an assistant can hand to a shell command or to the owner: one that
// adds a single image to one project, or one that downloads a single
// finished export. They work without a sign-in (a shell has no session), so
// each is random, short-lived, bound to one target, stored only as a hash
// and removed with its studio. An upload link works once.
export const MCP_LINK_PREFIX = "rll_";
export const UPLOAD_LINK_SECONDS = 900;
export const DOWNLOAD_LINK_SECONDS = 3600;
// Live links per studio; asking for more retires the oldest.
const MAX_LIVE_LINKS = 60;
export type McpLinkKind = "upload" | "download";
export type McpLink = {
  kind: McpLinkKind;
  workspaceId: string;
  userId: string;
  // The project (upload) or export job (download) the link is for.
  target: string;
  meta: Record<string, string>;
  expiresAt: number;
};
const hash = (token: string) =>
  createHash("sha256").update(token, "utf8").digest("hex");
export class McpLinkStore {
  constructor(private readonly db: Database.Database) {
    db.transaction(() =>
      db.exec(`CREATE TABLE IF NOT EXISTS mcp_links(
        token_hash TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        workspace_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        target TEXT NOT NULL,
        meta TEXT NOT NULL,
        expires_at INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS mcp_links_workspace ON mcp_links(workspace_id, expires_at);
      CREATE TRIGGER IF NOT EXISTS mcp_links_workspace_deleted AFTER DELETE ON workspaces
        BEGIN DELETE FROM mcp_links WHERE workspace_id=OLD.id; END;`),
    ).immediate();
  }
  issue(input: {
    kind: McpLinkKind;
    workspaceId: string;
    userId: string;
    target: string;
    meta?: Record<string, string>;
    now?: number;
  }) {
    const now = input.now ?? Date.now();
    const seconds =
      input.kind === "upload" ? UPLOAD_LINK_SECONDS : DOWNLOAD_LINK_SECONDS;
    const token = MCP_LINK_PREFIX + randomBytes(32).toString("base64url");
    this.db
      .transaction(() => {
        this.db.prepare("DELETE FROM mcp_links WHERE expires_at<?").run(now);
        this.db
          .prepare(
            `DELETE FROM mcp_links WHERE workspace_id=? AND token_hash NOT IN (
               SELECT token_hash FROM mcp_links WHERE workspace_id=?
               ORDER BY expires_at DESC LIMIT ?)`,
          )
          .run(input.workspaceId, input.workspaceId, MAX_LIVE_LINKS - 1);
        this.db
          .prepare(
            "INSERT INTO mcp_links(token_hash,kind,workspace_id,user_id,target,meta,expires_at) VALUES(?,?,?,?,?,?,?)",
          )
          .run(
            hash(token),
            input.kind,
            input.workspaceId,
            input.userId,
            input.target,
            JSON.stringify(input.meta ?? {}),
            now + seconds * 1000,
          );
      })
      .immediate();
    return { token, expiresInSeconds: seconds };
  }
  // The link a presented token stands for, if it is of that kind and live.
  resolve(
    token: string,
    kind: McpLinkKind,
    now = Date.now(),
  ): McpLink | undefined {
    if (
      !token.startsWith(MCP_LINK_PREFIX) ||
      token.length < 40 ||
      token.length > 80
    )
      return undefined;
    const row = this.db
      .prepare("SELECT * FROM mcp_links WHERE token_hash=?")
      .get(hash(token)) as
      | {
          kind: McpLinkKind;
          workspace_id: string;
          user_id: string;
          target: string;
          meta: string;
          expires_at: number;
        }
      | undefined;
    if (!row || row.kind !== kind || row.expires_at < now) return undefined;
    return {
      kind: row.kind,
      workspaceId: row.workspace_id,
      userId: row.user_id,
      target: row.target,
      meta: JSON.parse(row.meta),
      expiresAt: row.expires_at,
    };
  }
  // Retires a link (an upload link, once its file is in). False when another
  // request already used it.
  consume(token: string) {
    return (
      this.db
        .prepare("DELETE FROM mcp_links WHERE token_hash=?")
        .run(hash(token)).changes > 0
    );
  }
}
