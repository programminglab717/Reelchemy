import type Database from "better-sqlite3";
import {
  normalizeCopiedJobHistory,
  verifyJobHistoryAccounting,
} from "./job-history-store";
import { readRetiredJob } from "./job-history-references";
import {
  maximumIndexedJobs,
  JobHistoryUnavailable,
} from "./job-history-policy";
const table = (db: Database.Database, name: string) =>
  !!db
    .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?")
    .get(name);
export function snapshotHasJobHistory(db: Database.Database) {
  return (
    table(db, "job_history_sizes") ||
    (table(db, "job_history_retirements") &&
      !!db.prepare("SELECT 1 FROM job_history_retirements LIMIT 1").get())
  );
}
export function normalizeJobHistorySnapshot(db: Database.Database) {
  if (!snapshotHasJobHistory(db)) return;
  try {
    normalizeCopiedJobHistory(db);
  } catch {
    throw new JobHistoryUnavailable();
  }
}
export function verifyJobHistorySnapshot(db: Database.Database) {
  try {
    verifyJobHistoryAccounting(db);
    const total = (
      db.prepare("SELECT count(*) AS n FROM job_history_retirements").get() as {
        n: number;
      }
    ).n;
    if (total > maximumIndexedJobs) throw new JobHistoryUnavailable();
    let cursor = "",
      seen = 0;
    while (true) {
      const rows = db
        .prepare(
          "SELECT CASE WHEN length(CAST(job_id AS BLOB))<=160 THEN job_id END AS id FROM job_history_retirements WHERE job_id>? ORDER BY job_id LIMIT 20",
        )
        .all(cursor) as { id: string | null }[];
      if (!rows.length) break;
      for (const row of rows) {
        if (!row.id) throw new JobHistoryUnavailable();
        const value = readRetiredJob(db, row.id);
        if (!value) throw new JobHistoryUnavailable();
        const actual = db
          .prepare(
            "SELECT asset_id FROM job_media_refs WHERE job_id=? ORDER BY asset_id LIMIT 1025",
          )
          .all(row.id) as { asset_id: string }[];
        if (
          actual.length !== value.sourceIds.length ||
          actual.some(
            (entry, index) => entry.asset_id !== value.sourceIds[index],
          )
        )
          throw new JobHistoryUnavailable();
        seen++;
      }
      cursor = rows.at(-1)!.id!;
    }
    if (seen !== total) throw new JobHistoryUnavailable();
  } catch {
    throw new JobHistoryUnavailable();
  }
}
