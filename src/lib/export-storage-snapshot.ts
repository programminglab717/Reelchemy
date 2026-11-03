import type Database from "better-sqlite3";
import path from "node:path";
import { collectExportCensus } from "./export-storage-census";
import {
  publishExportCensus,
  assertExportStorageComplete,
} from "./export-storage-store";
import {
  exportStoragePolicy,
  ExportStorageUnavailable,
} from "./export-storage-policy";
import { validExportFilename } from "./export-file-policy";
export const snapshotHasExportStorage = (db: Database.Database) =>
  !!db
    .prepare(
      "SELECT 1 FROM sqlite_master WHERE type='table' AND name='export_storage_entries'",
    )
    .get();
// Only pass a newly copied offline snapshot. Source installations are never
// normalized here. Queued renders restore as failed, preserving their timeline.
export async function normalizeExportStorageSnapshot(
  db: Database.Database,
  artifacts: string,
) {
  if (!snapshotHasExportStorage(db)) return false;
  try {
    if (
      (
        db.prepare("SELECT count(*) AS count FROM jobs").get() as {
          count: number;
        }
      ).count > 100000
    )
      throw new ExportStorageUnavailable();
    let cursor = 0;
    while (true) {
      const rows = db
        .prepare(
          "SELECT rowid AS cursor,id,project_id,status,CASE WHEN length(CAST(data AS BLOB))<=4194304 THEN data ELSE NULL END AS data FROM jobs WHERE rowid>? ORDER BY rowid LIMIT 20",
        )
        .all(cursor) as {
        cursor: number;
        id: string;
        project_id: string;
        status: string;
        data: string | null;
      }[];
      if (!rows.length) break;
      db.transaction(() => {
        for (const row of rows) {
          if (!row.data) throw new ExportStorageUnavailable();
          const job = JSON.parse(row.data);
          if (!job || typeof job !== "object" || Array.isArray(job))
            throw new ExportStorageUnavailable();
          job.id = row.id;
          job.projectId = row.project_id;
          job.status = row.status;
          delete job.files;
          if (["queued", "rendering"].includes(row.status)) {
            job.status = "failed";
            job.progress = 0;
            job.stage = "Restored";
            job.error =
              "Restored from backup. Start a new export from the saved project.";
          }
          if (
            job.report?.export &&
            typeof job.report.export === "object" &&
            !Array.isArray(job.report.export)
          )
            job.report.export.path = path.join(artifacts, row.id, "video.mp4");
          db.prepare("UPDATE jobs SET status=?,data=? WHERE id=?").run(
            job.status,
            JSON.stringify(job),
            row.id,
          );
        }
      }).immediate();
      cursor = rows.at(-1)!.cursor;
    }
    const footprints = await collectExportCensus(db, artifacts);
    publishExportCensus(db, footprints, exportStoragePolicy({}));
    for (const table of ["render_job_attempts", "export_file_reviews"])
      if (
        db
          .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?")
          .get(table)
      )
        db.exec(`DELETE FROM ${table}`);
    return true;
  } catch {
    throw new ExportStorageUnavailable();
  }
}
export function verifyExportStorageSnapshot(
  db: Database.Database,
  entries: ReadonlyArray<{ path: string; bytes: number }>,
) {
  assertExportStorageComplete(db);
  const actual = new Map<string, { bytes: number; files: number }>();
  for (const entry of entries) {
    if (!entry.path.startsWith("artifacts/")) continue;
    const match = /^artifacts\/([a-f0-9-]{36})\/([^/]+)$/.exec(entry.path);
    if (!match || !validExportFilename(match[2]))
      throw new ExportStorageUnavailable();
    const value = actual.get(match[1]) ?? { bytes: 0, files: 0 };
    value.bytes += entry.bytes;
    value.files++;
    if (!Number.isSafeInteger(value.bytes))
      throw new ExportStorageUnavailable();
    actual.set(match[1], value);
  }
  const document =
    "CASE WHEN length(CAST(j.data AS BLOB))<=4194304 THEN CASE WHEN json_valid(j.data) THEN j.data ELSE '{}' END ELSE '{}' END";
  const query = `SELECT j.id,j.project_id,j.status,e.retained_bytes,e.retained_files,e.reservation_bytes,e.dirty,json_extract(${document},'$.id') AS data_id,json_extract(${document},'$.projectId') AS data_project,json_extract(${document},'$.status') AS data_status,json_type(${document},'$.files') AS embedded_files FROM jobs j JOIN export_storage_entries e ON e.job_id=j.id`;
  for (const row of db.prepare(query).iterate() as Iterable<{
    id: string;
    project_id: string;
    status: string;
    retained_bytes: number;
    retained_files: number;
    reservation_bytes: number;
    dirty: number;
    data_id: unknown;
    data_project: unknown;
    data_status: unknown;
    embedded_files: unknown;
  }>) {
    const observed = actual.get(row.id) ?? { bytes: 0, files: 0 };
    if (
      !["completed", "failed", "cancelled"].includes(row.status) ||
      row.data_id !== row.id ||
      row.data_project !== row.project_id ||
      row.data_status !== row.status ||
      row.embedded_files !== null ||
      row.reservation_bytes !== 0 ||
      row.dirty !== 0 ||
      row.retained_bytes !== observed.bytes ||
      row.retained_files !== observed.files
    )
      throw new ExportStorageUnavailable();
    actual.delete(row.id);
  }
  if (actual.size) throw new ExportStorageUnavailable();
}
