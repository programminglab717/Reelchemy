import type Database from "better-sqlite3";
import { z } from "zod";
import { measureExportFiles } from "./export-storage-files";
import { ExportStorageUnavailable } from "./export-storage-policy";
import type { ExportFootprint } from "./export-storage-store";
// Read-only collection. The operator entrypoint must first stop writers and
// hold both consumer lifecycle locks; publishing independently rechecks context.
export async function collectExportCensus(
  db: Database.Database,
  root: string,
  signal?: AbortSignal,
) {
  const rows = db
    .prepare(
      "SELECT j.id,j.project_id,j.status,p.id AS owner_project,p.workspace_id FROM jobs j LEFT JOIN projects p ON p.id=j.project_id ORDER BY j.id LIMIT 100001",
    )
    .all() as {
    id: string;
    project_id: string;
    status: string;
    owner_project: string | null;
    workspace_id: string | null;
  }[];
  if (rows.length > 100000) throw new ExportStorageUnavailable();
  const hasRemovalTable = !!db
      .prepare(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name='export_file_removals'",
      )
      .get(),
    removal = hasRemovalTable
      ? db.prepare("SELECT state FROM export_file_removals WHERE job_id=?")
      : undefined;
  const result: ExportFootprint[] = [];
  for (const row of rows) {
    if (
      signal?.aborted ||
      !z.uuid().safeParse(row.id).success ||
      row.owner_project !== row.project_id ||
      typeof row.project_id !== "string" ||
      row.project_id.length < 1 ||
      row.project_id.length > 160 ||
      (row.workspace_id !== null &&
        (typeof row.workspace_id !== "string" ||
          row.workspace_id.length < 1 ||
          row.workspace_id.length > 80)) ||
      !["queued", "completed", "failed", "cancelled"].includes(row.status)
    )
      throw new ExportStorageUnavailable();
    const measured = await measureExportFiles(root, row.id, {
        isStopping: () => !!signal?.aborted,
      }),
      receipt = removal?.get(row.id) as { state: string } | undefined;
    if (receipt?.state === "completed" && measured.files)
      throw new ExportStorageUnavailable();
    result.push({
      jobId: row.id,
      projectId: row.project_id,
      workspaceId: row.workspace_id,
      status: row.status,
      ...measured,
    });
  }
  if (signal?.aborted) throw new ExportStorageUnavailable();
  return result;
}
