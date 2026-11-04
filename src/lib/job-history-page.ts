import type Database from "better-sqlite3";
import { z } from "zod";
import { boundedProjectLabelSql } from "./project-label";
import type { RenderJob } from "./schema";
import {
  encodeExportCursor,
  decodeExportCursor,
} from "./export-history-cursor";
export type JobHistorySummary = Pick<
  RenderJob,
  "id" | "projectId" | "status"
> & { projectName: string; bytes: number; inTrash: boolean; eligible: boolean };
export type JobHistoryPage = {
  items: JobHistorySummary[];
  anchor: string;
  nextBefore: string | null;
  unavailable: number;
};
export class JobHistoryPageUnavailable extends Error {}
const scope = "studio-job-history:v1",
  domain = "workspace-job-history" as const;
export function ownedJobHistoryPage(
  db: Database.Database,
  workspaceId: string,
  cursor: { anchor?: string; before?: string } = {},
): JobHistoryPage {
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
                  .prepare("SELECT COALESCE(max(rowid),0) AS n FROM jobs")
                  .get() as { n: number }
              ).n
            : decodeExportCursor(
                cursor.anchor,
                scope,
                workspaceId,
                "anchor",
                domain,
              )[0];
        if (cursor.before !== undefined) {
          const [bound, position] = decodeExportCursor(
            cursor.before,
            scope,
            workspaceId,
            "before",
            domain,
          );
          if (bound !== anchor || position < 1 || position > anchor)
            throw new Error();
          before = position;
        }
      } catch {
        throw new JobHistoryPageUnavailable();
      }
      const rows = db
        .prepare(
          `SELECT j.rowid AS position,j.id,j.project_id AS projectId,j.status,s.bytes,p.trashed_at IS NOT NULL AS inTrash,
      ${boundedProjectLabelSql} AS projectName,
      e.job_id IS NOT NULL AND e.retained_bytes=0 AND e.retained_files=0 AND e.reservation_bytes=0 AND e.dirty=0 AND s.reservation_bytes=0 AND p.trashed_at IS NULL
      AND NOT EXISTS(SELECT 1 FROM render_job_attempts WHERE job_id=j.id) AND NOT EXISTS(SELECT 1 FROM export_file_removals WHERE job_id=j.id AND state<>'completed') AS eligible
      FROM jobs j JOIN projects p ON p.id=j.project_id JOIN job_history_sizes s ON s.job_id=j.id AND s.project_id=j.project_id AND s.workspace_id IS p.workspace_id
      LEFT JOIN export_storage_entries e ON e.job_id=j.id AND e.project_id=j.project_id AND e.workspace_id IS p.workspace_id
      WHERE p.workspace_id=? AND j.status IN ('completed','failed','cancelled') AND NOT EXISTS(SELECT 1 FROM job_history_retirements WHERE job_id=j.id)
      AND NOT EXISTS(SELECT 1 FROM project_deletions WHERE project_id=p.id) AND j.rowid<=? ${before === undefined ? "" : "AND j.rowid<?"}
      ORDER BY j.rowid DESC LIMIT 21`,
        )
        .all(
          workspaceId,
          anchor,
          ...(before === undefined ? [] : [before]),
        ) as (Omit<JobHistorySummary, "inTrash" | "eligible"> & {
        position: number;
        inTrash: number;
        eligible: number;
      })[];
      const selected = rows.slice(0, 20),
        items: JobHistorySummary[] = [];
      for (const row of selected) {
        if (
          !z.uuid().safeParse(row.id).success ||
          typeof row.projectId !== "string" ||
          !row.projectId.length ||
          row.projectId.length > 160 ||
          /[\x00-\x1f\x7f]/.test(row.projectId) ||
          !Number.isSafeInteger(row.bytes) ||
          row.bytes < 0
        )
          continue;
        items.push({
          id: row.id,
          projectId: row.projectId,
          status: row.status,
          bytes: row.bytes,
          projectName:
            typeof row.projectName === "string" && row.projectName.trim()
              ? row.projectName
              : "Saved project",
          inTrash: !!row.inTrash,
          eligible: !!row.eligible,
        });
      }
      return {
        items,
        anchor: encodeExportCursor(
          scope,
          workspaceId,
          "anchor",
          [anchor],
          domain,
        ),
        nextBefore:
          rows.length > 20
            ? encodeExportCursor(
                scope,
                workspaceId,
                "before",
                [anchor, selected.at(-1)!.position],
                domain,
              )
            : null,
        unavailable: selected.length - items.length,
      };
    })
    .deferred();
}
