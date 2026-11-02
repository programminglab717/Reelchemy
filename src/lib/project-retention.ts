import type Database from "better-sqlite3";
import { createHash } from "node:crypto";
import { z } from "zod";
export const retentionSelection = z.object({
  keepVersions: z.number().int().min(1).max(10000),
  keepMessages: z.number().int().min(1).max(10000),
});
export type RetentionSelection = z.infer<typeof retentionSelection>;
export type ProjectRetentionPlan = RetentionSelection & {
  projectId: string;
  digest: string;
  latestRevisionId: string | null;
  bytesBefore: number;
  bytesAfter: number;
  versionsBefore: number;
  versionsAfter: number;
  messagesBefore: number;
  messagesAfter: number;
};
export type ProjectRetentionResult = {
  projectId: string;
  requestId: string;
  versionsRemoved: number;
  messagesRemoved: number;
  bytesFreed: number;
  replayed: boolean;
};
const resultSchema = z
  .object({
    projectId: z.string().min(1).max(160),
    requestId: z.string().regex(/^[a-zA-Z0-9_-]{16,80}$/),
    versionsRemoved: z.number().int().min(0),
    messagesRemoved: z.number().int().min(0),
    bytesFreed: z
      .number()
      .int()
      .min(0)
      .max(64 * 1024 ** 2),
    replayed: z.boolean(),
  })
  .strict();
export class ProjectRetentionConflict extends Error {
  constructor() {
    super(
      "Saved project data changed after the preview. Review a new cleanup preview before removing history. Your current edits are kept here.",
    );
  }
}
export class ProjectRetentionUnavailable extends Error {
  constructor() {
    super(
      "This saved history cannot be cleaned safely. Keep a project backup and contact the studio operator.",
    );
  }
}
const maxLegacyBytes = 64 * 1024 ** 2;
const digest = (data: string, selection: RetentionSelection) =>
  createHash("sha256")
    .update("project-retention-v1\0")
    .update(data)
    .update("\0")
    .update(JSON.stringify(selection))
    .digest("hex");
const active =
  "p.id=? AND p.workspace_id=? AND p.trashed_at IS NULL AND NOT EXISTS(SELECT 1 FROM project_deletions d WHERE d.project_id=p.id)";
function selected(
  db: Database.Database,
  projectId: string,
  workspaceId: string,
  selection: RetentionSelection,
) {
  selection = retentionSelection.parse(selection);
  const row = db
    .prepare(
      `SELECT CASE WHEN length(CAST(p.data AS BLOB))<=${maxLegacyBytes} THEN p.data ELSE NULL END AS data FROM projects p WHERE ${active}`,
    )
    .get(projectId, workspaceId) as { data: string | null } | undefined;
  if (!row) return undefined;
  if (!row.data) throw new ProjectRetentionUnavailable();
  // SQLite keeps historical payloads out of JS objects, including large legacy
  // fields. Only the bounded raw string is hashed for the exact cleanup preview.
  const sliced = db
    .prepare(
      `SELECT json_array_length(data,'$.revisions') AS versionsBefore,json_array_length(data,'$.messages') AS messagesBefore,json_extract(data,'$.revisions[#-1].id') AS latestId,
    json_set(data,'$.revisions',json((SELECT json_group_array(json(entry)) FROM (SELECT projects.data -> r.fullkey AS entry FROM json_each(projects.data,'$.revisions') r WHERE CAST(r.key AS INTEGER)>=max(0,json_array_length(projects.data,'$.revisions')-?) ORDER BY CAST(r.key AS INTEGER)))),
    '$.messages',json((SELECT json_group_array(json(entry)) FROM (SELECT projects.data -> m.fullkey AS entry FROM json_each(projects.data,'$.messages') m WHERE CAST(m.key AS INTEGER)>=max(0,json_array_length(projects.data,'$.messages')-?) ORDER BY CAST(m.key AS INTEGER))))) AS next
    FROM projects WHERE id=? AND json_valid(data) AND json_type(data,'$.revisions')='array' AND json_type(data,'$.messages')='array'`,
    )
    .get(selection.keepVersions, selection.keepMessages, projectId) as
    | {
        versionsBefore: number;
        messagesBefore: number;
        latestId: unknown;
        next: string;
      }
    | undefined;
  if (
    !sliced ||
    (sliced.versionsBefore &&
      (typeof sliced.latestId !== "string" ||
        !sliced.latestId ||
        sliced.latestId.length > 80 ||
        /[\x00-\x1f\x7f]/.test(sliced.latestId)))
  )
    throw new ProjectRetentionUnavailable();
  const unchanged =
    sliced.versionsBefore <= selection.keepVersions &&
    sliced.messagesBefore <= selection.keepMessages;
  const next = unchanged ? row.data : sliced.next;
  if (Buffer.byteLength(next) > Buffer.byteLength(row.data))
    throw new ProjectRetentionUnavailable();
  const plan: ProjectRetentionPlan = {
    ...selection,
    projectId,
    digest: digest(row.data, selection),
    latestRevisionId:
      typeof sliced.latestId === "string" ? sliced.latestId : null,
    bytesBefore: Buffer.byteLength(row.data),
    bytesAfter: Buffer.byteLength(next),
    versionsBefore: sliced.versionsBefore,
    versionsAfter: Math.min(selection.keepVersions, sliced.versionsBefore),
    messagesBefore: sliced.messagesBefore,
    messagesAfter: Math.min(selection.keepMessages, sliced.messagesBefore),
  };
  return { plan, data: next };
}
export function previewProjectRetention(
  db: Database.Database,
  projectId: string,
  workspaceId: string,
  selection: RetentionSelection,
) {
  return db
    .transaction(() => selected(db, projectId, workspaceId, selection)?.plan)
    .deferred();
}
export function applyProjectRetention(
  db: Database.Database,
  projectId: string,
  workspaceId: string,
  selection: RetentionSelection,
  expected: string,
  requestId: string,
) {
  if (
    !/^[a-f0-9]{64}$/.test(expected) ||
    !/^[a-zA-Z0-9_-]{16,80}$/.test(requestId)
  )
    throw new ProjectRetentionUnavailable();
  return db
    .transaction(() => {
      if (
        !db
          .prepare(`SELECT 1 FROM projects p WHERE ${active}`)
          .get(projectId, workspaceId)
      )
        return undefined;
      const receipt = db
        .prepare(
          "SELECT request_id,digest,selection,result FROM project_retention_receipts WHERE project_id=?",
        )
        .get(projectId) as
        | {
            request_id: string;
            digest: string;
            selection: string;
            result: string;
          }
        | undefined;
      const key = JSON.stringify(retentionSelection.parse(selection));
      if (receipt?.request_id === requestId) {
        if (receipt.digest !== expected || receipt.selection !== key)
          throw new ProjectRetentionConflict();
        try {
          const result = resultSchema.parse(JSON.parse(receipt.result));
          if (result.projectId !== projectId || result.requestId !== requestId)
            throw new ProjectRetentionUnavailable();
          return { ...result, replayed: true };
        } catch {
          throw new ProjectRetentionUnavailable();
        }
      }
      const current = selected(db, projectId, workspaceId, selection)!;
      if (current.plan.digest !== expected)
        throw new ProjectRetentionConflict();
      const plan = current.plan;
      const result: ProjectRetentionResult = {
        projectId,
        requestId,
        versionsRemoved: plan.versionsBefore - plan.versionsAfter,
        messagesRemoved: plan.messagesBefore - plan.messagesAfter,
        bytesFreed: Math.max(0, plan.bytesBefore - plan.bytesAfter),
        replayed: false,
      };
      if (result.versionsRemoved || result.messagesRemoved)
        db.prepare("UPDATE projects SET data=? WHERE id=?").run(
          current.data,
          projectId,
        );
      db.prepare(
        "INSERT INTO project_retention_receipts VALUES(?,?,?,?,?) ON CONFLICT(project_id) DO UPDATE SET request_id=excluded.request_id,digest=excluded.digest,selection=excluded.selection,result=excluded.result",
      ).run(projectId, requestId, expected, key, JSON.stringify(result));
      return result;
    })
    .immediate();
}
