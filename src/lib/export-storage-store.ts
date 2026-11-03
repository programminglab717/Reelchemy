import type Database from "better-sqlite3";
import {
  ExportStorageUnavailable,
  ExportStorageLimit,
  type ExportStoragePolicy,
  type ExportStorageUsage,
} from "./export-storage-policy";
const migration = "export-storage-census-v1";
export type ExportFootprint = {
  jobId: string;
  projectId: string;
  workspaceId: string | null;
  status: string;
  bytes: number;
  files: number;
};
type Ledger = {
  job_id: string;
  project_id: string;
  workspace_id: string | null;
  retained_bytes: number;
  retained_files: number;
  reservation_bytes: number;
  ceiling_bytes: number;
  dirty: number;
};
type Totals = {
  bytes: number;
  reserved: number;
  retained: number;
  pending: number;
  count: number;
};
function bounded(value: number, max = Number.MAX_SAFE_INTEGER) {
  if (!Number.isSafeInteger(value) || value < 0 || value > max)
    throw new ExportStorageUnavailable();
  return value;
}
function totals(db: Database.Database, workspaceId?: string): Totals {
  const result = db
    .prepare(
      `SELECT COALESCE(sum(retained_bytes),0) AS bytes,COALESCE(sum(max(0,reservation_bytes-retained_bytes)),0) AS reserved,COALESCE(sum(retained_files>0),0) AS retained,COALESCE(sum(reservation_bytes>0),0) AS pending,COALESCE(sum(retained_files>0 OR reservation_bytes>0),0) AS count FROM export_storage_entries ${workspaceId === undefined ? "" : "WHERE workspace_id=?"}`,
    )
    .get(...(workspaceId === undefined ? [] : [workspaceId])) as Totals;
  for (const n of Object.values(result)) bounded(n);
  bounded(result.bytes + result.reserved);
  return result;
}
export function migrateExportStorage(db: Database.Database) {
  db.transaction(() => {
    db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations(id TEXT PRIMARY KEY,applied_at TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS export_storage_entries(job_id TEXT PRIMARY KEY,project_id TEXT NOT NULL,workspace_id TEXT,retained_bytes INTEGER NOT NULL DEFAULT 0 CHECK(retained_bytes>=0 AND retained_bytes<=4398046511104),retained_files INTEGER NOT NULL DEFAULT 0 CHECK(retained_files>=0 AND retained_files<=4096),reservation_bytes INTEGER NOT NULL DEFAULT 0 CHECK(reservation_bytes>=0 AND reservation_bytes<=1073741824),ceiling_bytes INTEGER NOT NULL CHECK(ceiling_bytes>=1048576 AND ceiling_bytes<=1073741824),dirty INTEGER NOT NULL DEFAULT 0 CHECK(dirty IN (0,1)));
 CREATE INDEX IF NOT EXISTS export_storage_owner_idx ON export_storage_entries(workspace_id);
 CREATE TRIGGER IF NOT EXISTS export_storage_render_admission BEFORE UPDATE OF status ON jobs WHEN NEW.status='rendering' AND NOT EXISTS(SELECT 1 FROM export_storage_entries e JOIN projects p ON p.id=NEW.project_id WHERE e.job_id=NEW.id AND e.project_id=NEW.project_id AND e.workspace_id IS p.workspace_id AND e.reservation_bytes>0 AND p.trashed_at IS NULL AND NOT EXISTS(SELECT 1 FROM project_deletions d WHERE d.project_id=p.id)) BEGIN SELECT RAISE(ABORT,'A captured export storage reservation is required before rendering.'); END;
 CREATE TRIGGER IF NOT EXISTS export_storage_attempt_started AFTER UPDATE OF status ON jobs WHEN NEW.status='rendering' BEGIN UPDATE export_storage_entries SET dirty=1 WHERE job_id=NEW.id; END;
 CREATE TRIGGER IF NOT EXISTS export_storage_pristine_terminal AFTER UPDATE OF status ON jobs WHEN OLD.status='queued' AND NEW.status IN ('cancelled','failed','completed') AND NOT EXISTS(SELECT 1 FROM render_job_attempts a WHERE a.job_id=NEW.id) BEGIN UPDATE export_storage_entries SET reservation_bytes=0 WHERE job_id=NEW.id AND dirty=0; END;
 CREATE TRIGGER IF NOT EXISTS export_storage_job_deleted AFTER DELETE ON jobs BEGIN DELETE FROM export_storage_entries WHERE job_id=OLD.id; END;
 CREATE TRIGGER IF NOT EXISTS export_storage_job_moved BEFORE UPDATE OF project_id ON jobs WHEN NEW.project_id IS NOT OLD.project_id AND EXISTS(SELECT 1 FROM export_storage_entries e WHERE e.job_id=OLD.id) BEGIN SELECT RAISE(ABORT,'Export storage ownership cannot move to another project.'); END;
 CREATE TRIGGER IF NOT EXISTS export_storage_project_owner AFTER UPDATE OF workspace_id ON projects WHEN NEW.workspace_id IS NOT OLD.workspace_id BEGIN UPDATE export_storage_entries SET workspace_id=NEW.workspace_id WHERE project_id=NEW.id; END;`);
    // No historical filesystem is silently adopted during web startup.
    if (
      !db.prepare("SELECT 1 FROM jobs LIMIT 1").get() &&
      !db.prepare("SELECT 1 FROM export_storage_entries LIMIT 1").get()
    )
      db.prepare("INSERT OR IGNORE INTO schema_migrations VALUES(?,?)").run(
        migration,
        new Date().toISOString(),
      );
  }).immediate();
}
export function assertExportStorageComplete(
  db: Database.Database,
  prospectiveJob?: string,
) {
  if (!db.prepare("SELECT 1 FROM schema_migrations WHERE id=?").get(migration))
    throw new ExportStorageUnavailable();
  if (
    db
      .prepare(
        `SELECT 1 FROM jobs j LEFT JOIN projects p ON p.id=j.project_id LEFT JOIN export_storage_entries e ON e.job_id=j.id WHERE ${prospectiveJob === undefined ? "" : "j.id<>? AND "}(p.id IS NULL OR e.job_id IS NULL OR e.project_id IS NOT j.project_id OR e.workspace_id IS NOT p.workspace_id) LIMIT 1`,
      )
      .get(...(prospectiveJob === undefined ? [] : [prospectiveJob]))
  )
    throw new ExportStorageUnavailable();
  if (
    db
      .prepare(
        "SELECT 1 FROM export_storage_entries e LEFT JOIN jobs j ON j.id=e.job_id WHERE j.id IS NULL LIMIT 1",
      )
      .get()
  )
    throw new ExportStorageUnavailable();
}
export function exportStorageUsage(
  db: Database.Database,
  workspaceId: string,
  policy: ExportStoragePolicy,
): ExportStorageUsage {
  assertExportStorageComplete(db);
  const t = totals(db, workspaceId);
  return {
    usedBytes: t.bytes,
    reservedBytes: t.reserved,
    limitBytes: policy.studioBytes,
    availableBytes: Math.max(0, policy.studioBytes - t.bytes - t.reserved),
    retainedExports: t.retained,
    pendingExports: t.pending,
    limitExports: policy.studioExports,
    outputCeilingBytes: policy.reservationBytes,
  };
}
export function reserveExportStorage(
  db: Database.Database,
  jobId: string,
  projectId: string,
  workspaceId: string | null,
  policy: ExportStoragePolicy,
) {
  return db
    .transaction(() => {
      const source = db
        .prepare(
          "SELECT j.status,p.workspace_id,p.trashed_at FROM jobs j JOIN projects p ON p.id=j.project_id WHERE j.id=? AND j.project_id=? AND NOT EXISTS(SELECT 1 FROM project_deletions d WHERE d.project_id=p.id)",
        )
        .get(jobId, projectId) as
        | {
            status: string;
            workspace_id: string | null;
            trashed_at: string | null;
          }
        | undefined;
      if (
        !source ||
        source.workspace_id !== workspaceId ||
        source.trashed_at ||
        !["queued", "rendering"].includes(source.status)
      )
        throw new ExportStorageUnavailable();
      const existing = db
        .prepare("SELECT * FROM export_storage_entries WHERE job_id=?")
        .get(jobId) as Ledger | undefined;
      if (existing) {
        if (
          existing.project_id !== projectId ||
          existing.workspace_id !== workspaceId ||
          !existing.reservation_bytes
        )
          throw new ExportStorageUnavailable();
        return existing.ceiling_bytes;
      }
      assertExportStorageComplete(db, jobId);
      const shared = totals(db),
        studio = workspaceId === null ? undefined : totals(db, workspaceId);
      if (studio) {
        if (
          studio.bytes + studio.reserved + policy.reservationBytes >
          policy.studioBytes
        )
          throw new ExportStorageLimit("studio", "bytes");
        if (studio.count + 1 > policy.studioExports)
          throw new ExportStorageLimit("studio", "exports");
      }
      if (
        shared.bytes + shared.reserved + policy.reservationBytes >
        policy.serviceBytes
      )
        throw new ExportStorageLimit("service", "bytes");
      if (shared.count + 1 > policy.serviceExports)
        throw new ExportStorageLimit("service", "exports");
      db.prepare(
        "INSERT INTO export_storage_entries(job_id,project_id,workspace_id,reservation_bytes,ceiling_bytes) VALUES(?,?,?,?,?)",
      ).run(
        jobId,
        projectId,
        workspaceId,
        policy.reservationBytes,
        policy.reservationBytes,
      );
      return policy.reservationBytes;
    })
    .immediate();
}
export function exportOutputCeiling(
  db: Database.Database,
  jobId: string,
  policy: ExportStoragePolicy,
) {
  assertExportStorageComplete(db);
  const row = db
    .prepare(
      "SELECT ceiling_bytes,reservation_bytes FROM export_storage_entries WHERE job_id=?",
    )
    .get(jobId) as
    { ceiling_bytes: number; reservation_bytes: number } | undefined;
  if (!row || !row.reservation_bytes) throw new ExportStorageUnavailable();
  return Math.min(row.ceiling_bytes, policy.reservationBytes);
}
// A consumer calls this after native teardown. Failed/retried output still
// counts; a retry retains the same captured reservation instead of reserving twice.
export function settleExportStorage(
  db: Database.Database,
  jobId: string,
  bytes: number,
  files: number,
  release: boolean,
) {
  bounded(bytes, 4 * 1024 ** 4);
  bounded(files, 4096);
  if ((bytes > 0 && files === 0) || (files === 0 && bytes !== 0))
    throw new ExportStorageUnavailable();
  return db
    .transaction(() => {
      const row = db
        .prepare(
          "SELECT e.*,j.status FROM export_storage_entries e JOIN jobs j ON j.id=e.job_id JOIN projects p ON p.id=j.project_id WHERE e.job_id=? AND e.project_id=j.project_id AND e.workspace_id IS p.workspace_id",
        )
        .get(jobId) as (Ledger & { status: string }) | undefined;
      if (!row) throw new ExportStorageUnavailable();
      if (release && !["completed", "failed", "cancelled"].includes(row.status))
        throw new ExportStorageUnavailable();
      db.prepare(
        "UPDATE export_storage_entries SET retained_bytes=?,retained_files=?,dirty=0,reservation_bytes=CASE WHEN ? THEN 0 ELSE reservation_bytes END WHERE job_id=?",
      ).run(bytes, files, release ? 1 : 0, jobId);
    })
    .immediate();
}
// Only after explicit stopped-writer, pinned filesystem census. Match every
// indexed job/context/status again under the writer lock before publishing it.
export function publishExportCensus(
  db: Database.Database,
  footprints: ExportFootprint[],
  policy: ExportStoragePolicy,
) {
  return db
    .transaction(() => {
      const rows = db
        .prepare(
          "SELECT j.id,j.project_id,j.status,p.id AS owner_project,p.workspace_id FROM jobs j LEFT JOIN projects p ON p.id=j.project_id ORDER BY j.id",
        )
        .all() as {
        id: string;
        project_id: string;
        status: string;
        workspace_id: string | null;
        owner_project: string | null;
      }[];
      const supplied = new Map(footprints.map((f) => [f.jobId, f]));
      if (supplied.size !== footprints.length || rows.length !== supplied.size)
        throw new ExportStorageUnavailable();
      for (const row of rows) {
        const f = supplied.get(row.id);
        if (
          !f ||
          f.projectId !== row.project_id ||
          f.workspaceId !== row.workspace_id ||
          f.status !== row.status ||
          row.owner_project === null ||
          row.status === "rendering"
        )
          throw new ExportStorageUnavailable();
        bounded(f.bytes, 4 * 1024 ** 4);
        bounded(f.files, 4096);
        if (f.bytes > 0 && !f.files) throw new ExportStorageUnavailable();
      }
      const previous = new Map(
        (
          db.prepare("SELECT * FROM export_storage_entries").all() as Ledger[]
        ).map((row) => [row.job_id, row]),
      );
      db.exec("DELETE FROM export_storage_entries");
      const insert = db.prepare(
        "INSERT INTO export_storage_entries VALUES(?,?,?,?,?,?,?,?)",
      );
      for (const row of rows) {
        const f = supplied.get(row.id)!;
        const old = previous.get(row.id);
        if (
          old &&
          (old.project_id !== row.project_id ||
            old.workspace_id !== row.workspace_id)
        )
          throw new ExportStorageUnavailable();
        const ceiling = old?.ceiling_bytes ?? policy.reservationBytes;
        insert.run(
          row.id,
          row.project_id,
          row.workspace_id,
          f.bytes,
          f.files,
          row.status === "queued"
            ? old?.reservation_bytes ||
                Math.min(ceiling, policy.reservationBytes)
            : 0,
          ceiling,
          0,
        );
      }
      // Unbudgeted legacy queues must fit before receiving a captured reservation.
      const pending = db
        .prepare(
          "SELECT DISTINCT workspace_id FROM export_storage_entries WHERE reservation_bytes>0 AND workspace_id IS NOT NULL",
        )
        .all() as { workspace_id: string }[];
      for (const { workspace_id } of pending) {
        const t = totals(db, workspace_id);
        if (
          t.bytes + t.reserved > policy.studioBytes ||
          t.count > policy.studioExports
        )
          throw new ExportStorageLimit("studio", "bytes");
      }
      const shared = totals(db);
      if (
        rows.some((r) => r.status === "queued") &&
        (shared.bytes + shared.reserved > policy.serviceBytes ||
          shared.count > policy.serviceExports)
      )
        throw new ExportStorageLimit("service", "bytes");
      db.prepare(
        "INSERT INTO schema_migrations VALUES(?,?) ON CONFLICT(id) DO UPDATE SET applied_at=excluded.applied_at",
      ).run(migration, new Date().toISOString());
    })
    .immediate();
}

// An unreadable output tree is never accounted as empty. Preserve the captured
// hold and stop fresh admission until a complete explicit census establishes it.
export function markExportStorageUncertain(
  db: Database.Database,
  jobId: string,
) {
  return db
    .transaction(() => {
      if (
        !db
          .prepare(
            "SELECT 1 FROM export_storage_entries e JOIN jobs j ON j.id=e.job_id JOIN projects p ON p.id=j.project_id WHERE e.job_id=? AND e.project_id=j.project_id AND e.workspace_id IS p.workspace_id",
          )
          .get(jobId)
      )
        throw new ExportStorageUnavailable();
      db.prepare("DELETE FROM schema_migrations WHERE id=?").run(migration);
    })
    .immediate();
}

// Once a stable footprint is known and the native attempt lease has gone,
// terminal work no longer needs its remaining hold. Retained bytes stay charged.
export function releaseKnownTerminalHolds(db: Database.Database) {
  return db
    .prepare(
      `UPDATE export_storage_entries AS e SET reservation_bytes=0 WHERE e.dirty=0 AND e.reservation_bytes>0 AND NOT EXISTS(SELECT 1 FROM render_job_attempts a WHERE a.job_id=e.job_id) AND EXISTS(SELECT 1 FROM jobs j JOIN projects p ON p.id=j.project_id WHERE j.id=e.job_id AND j.project_id=e.project_id AND p.workspace_id IS e.workspace_id AND j.status IN ('completed','failed','cancelled'))`,
    )
    .run().changes;
}
