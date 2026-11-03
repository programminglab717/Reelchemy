import type Database from "better-sqlite3";
import type { RenderJob } from "./schema";
import { z } from "zod";
import {
  encodeExportCursor,
  decodeExportCursor,
} from "./export-history-cursor";
export type ExportSummary = Pick<RenderJob, "id" | "projectId" | "status"> & {
  createdAt: string | null;
  fileState?: import("./export-file-policy").ExportFileState;
  retired?: boolean;
};
export type ExportPage = {
  items: ExportSummary[];
  anchor: string;
  nextBefore: string | null;
  total: number;
  unavailable: number;
};
export class ExportHistoryUnavailable extends Error {}
const active =
  "p.id=? AND p.workspace_id=? AND p.trashed_at IS NULL AND NOT EXISTS(SELECT 1 FROM project_deletions d WHERE d.project_id=p.id)";
const document = "CASE WHEN json_valid(j.data) THEN j.data ELSE '{}' END";
const date = `json_extract(${document},'$.createdAt')`;
export function ownedExportPage(
  db: Database.Database,
  projectId: string,
  workspaceId: string,
  cursor: { anchor?: string; before?: string } = {},
): ExportPage | undefined {
  return db
    .transaction(() => {
      if (
        !db
          .prepare(`SELECT 1 FROM projects p WHERE ${active}`)
          .get(projectId, workspaceId)
      )
        return;
      let anchor: number, before: number | undefined;
      try {
        if (cursor.before !== undefined && cursor.anchor === undefined)
          throw new Error();
        anchor =
          cursor.anchor === undefined
            ? (
                db
                  .prepare(
                    "SELECT COALESCE(max(rowid),0) AS value FROM jobs WHERE project_id=?",
                  )
                  .get(projectId) as { value: number }
              ).value
            : decodeExportCursor(
                cursor.anchor,
                projectId,
                workspaceId,
                "anchor",
              )[0];
        if (cursor.before !== undefined) {
          const [boundAnchor, position] = decodeExportCursor(
            cursor.before,
            projectId,
            workspaceId,
            "before",
          );
          if (boundAnchor !== anchor || position < 1 || position > anchor)
            throw new Error();
          before = position;
        }
      } catch {
        throw new ExportHistoryUnavailable();
      }
      if (!Number.isSafeInteger(anchor) || anchor < 0)
        throw new ExportHistoryUnavailable();
      const total = (
        db
          .prepare(
            "SELECT count(*) AS value FROM jobs WHERE project_id=? AND rowid<=?",
          )
          .get(projectId, anchor) as { value: number }
      ).value;
      const hasRemovalTable = !!db
        .prepare(
          "SELECT 1 FROM sqlite_master WHERE type='table' AND name='export_file_removals'",
        )
        .get();
      const rows = db
        .prepare(
          `SELECT j.rowid AS cursor, ${hasRemovalTable ? "(SELECT r.state FROM export_file_removals r WHERE r.job_id=j.id)" : "NULL"} AS fileState,
      ${db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='job_history_retirements'").get() ? "EXISTS(SELECT 1 FROM job_history_retirements WHERE job_id=j.id)" : "0"} AS retired,
      CASE WHEN length(CAST(j.id AS BLOB))<=640 THEN j.id ELSE NULL END AS id,
      CASE WHEN j.status IN ('queued','rendering','completed','failed','cancelled') THEN j.status ELSE NULL END AS status,
      CASE WHEN json_type(${document},'$.createdAt')='text' AND length(CAST(${date} AS BLOB))<=40 THEN ${date} ELSE NULL END AS createdAt
      FROM jobs j WHERE j.project_id=? AND j.rowid<=? ${before === undefined ? "" : "AND j.rowid<?"} ORDER BY j.rowid DESC LIMIT 21`,
        )
        .all(
          projectId,
          anchor,
          ...(before === undefined ? [] : [before]),
        ) as (ExportSummary & { cursor: number })[];
      const selected = rows.slice(0, 20),
        items: ExportSummary[] = [];
      for (const row of selected) {
        if (
          typeof row.id !== "string" ||
          !row.id.length ||
          row.id.length > 160 ||
          /[\x00-\x1f\x7f]/.test(row.id) ||
          !["queued", "rendering", "completed", "failed", "cancelled"].includes(
            row.status,
          )
        )
          continue;
        items.push({
          id: row.id,
          projectId,
          status: row.status,
          ...(row.fileState ? { fileState: row.fileState } : {}),
          ...(row.retired ? { retired: true } : {}),
          createdAt: z.iso.datetime({ offset: true }).safeParse(row.createdAt)
            .success
            ? new Date(row.createdAt!).toISOString()
            : null,
        });
      }
      return {
        items,
        anchor: encodeExportCursor(projectId, workspaceId, "anchor", [anchor]),
        total,
        nextBefore:
          rows.length > 20
            ? encodeExportCursor(projectId, workspaceId, "before", [
                anchor,
                selected.at(-1)!.cursor,
              ])
            : null,
        unavailable: selected.length - items.length,
      };
    })
    .deferred();
}
