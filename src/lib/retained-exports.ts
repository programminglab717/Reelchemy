import type Database from "better-sqlite3";
import { z } from "zod";
import {
  encodeExportCursor,
  decodeExportCursor,
} from "./export-history-cursor";
import { ExportHistoryUnavailable } from "./export-history";
import type { RenderJob } from "./schema";
import type { ExportFileState } from "./export-file-policy";

export type RetainedExport = Pick<RenderJob, "id" | "projectId" | "status"> & {
  projectName: string;
  bytes: number;
  fileCount: number;
  inTrash: boolean;
  processing: boolean;
  fileState: ExportFileState | null;
};
export type RetainedExportPage = {
  items: RetainedExport[];
  anchor: string;
  nextBefore: string | null;
};
// This cursor scope cannot be a generated project UUID. Every page separately
// checks the indexed owner; the token never grants access to a studio.
const scope = "studio-retained-exports:v1";
export function retainedExportPage(
  db: Database.Database,
  workspaceId: string,
  cursor: { anchor?: string; before?: string } = {},
): RetainedExportPage {
  return db
    .transaction(() => {
      let anchor: number, before: number | undefined;
      try {
        if (cursor.before !== undefined && cursor.anchor === undefined)
          throw new Error();
        anchor =
          cursor.anchor === undefined
            ? (
                db
                  .prepare("SELECT COALESCE(max(rowid),0) AS value FROM jobs")
                  .get() as { value: number }
              ).value
            : decodeExportCursor(
                cursor.anchor,
                scope,
                workspaceId,
                "anchor",
              )[0];
        if (cursor.before !== undefined) {
          const [bound, position] = decodeExportCursor(
            cursor.before,
            scope,
            workspaceId,
            "before",
          );
          if (bound !== anchor || position < 1 || position > anchor)
            throw new Error();
          before = position;
        }
      } catch {
        throw new ExportHistoryUnavailable();
      }
      const rows = db
        .prepare(
          `SELECT j.rowid AS position,j.id,j.project_id AS projectId,j.status,
      e.retained_bytes AS bytes,e.retained_files AS fileCount,
      p.trashed_at IS NOT NULL AS inTrash,
      EXISTS(SELECT 1 FROM render_job_attempts a WHERE a.job_id=j.id) AS processing,
      r.state AS fileState,
      CASE WHEN length(CAST(p.data AS BLOB))<=4194304 THEN
        CASE WHEN json_valid(p.data) THEN substr(json_extract(p.data,'$.name'),1,100) END END AS projectName
      FROM export_storage_entries e JOIN jobs j ON j.id=e.job_id AND j.project_id=e.project_id
      JOIN projects p ON p.id=j.project_id AND p.workspace_id=e.workspace_id
      LEFT JOIN export_file_removals r ON r.job_id=j.id AND r.project_id=p.id AND r.workspace_id=p.workspace_id
      WHERE p.workspace_id=? AND e.retained_files>0 AND j.status IN ('completed','failed','cancelled')
      AND NOT EXISTS(SELECT 1 FROM project_deletions d WHERE d.project_id=p.id)
      AND j.rowid<=? ${before === undefined ? "" : "AND j.rowid<?"}
      ORDER BY j.rowid DESC LIMIT 21`,
        )
        .all(
          workspaceId,
          anchor,
          ...(before === undefined ? [] : [before]),
        ) as (Omit<RetainedExport, "inTrash" | "processing"> & {
        position: number;
        inTrash: number;
        processing: number;
      })[];
      const selected = rows.slice(0, 20);
      const items = selected.map((row) => {
        if (
          !z.uuid().safeParse(row.id).success ||
          !z.uuid().safeParse(row.projectId).success ||
          !Number.isSafeInteger(row.bytes) ||
          row.bytes < 0 ||
          !Number.isSafeInteger(row.fileCount) ||
          row.fileCount < 1 ||
          (row.fileState !== null &&
            !["queued", "working", "failed", "completed"].includes(
              row.fileState,
            ))
        )
          throw new ExportHistoryUnavailable();
        return {
          id: row.id,
          projectId: row.projectId,
          status: row.status,
          projectName:
            typeof row.projectName === "string" && row.projectName.trim()
              ? row.projectName
              : "Saved project",
          bytes: row.bytes,
          fileCount: row.fileCount,
          inTrash: !!row.inTrash,
          processing: !!row.processing,
          fileState: row.fileState,
        };
      });
      return {
        items,
        anchor: encodeExportCursor(scope, workspaceId, "anchor", [anchor]),
        nextBefore:
          rows.length > 20
            ? encodeExportCursor(scope, workspaceId, "before", [
                anchor,
                selected.at(-1)!.position,
              ])
            : null,
      };
    })
    .deferred();
}
