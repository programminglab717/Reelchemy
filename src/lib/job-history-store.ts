import type Database from "better-sqlite3";
import {
  jobDocumentReservationBytes,
  maximumJobDocumentBytes,
  maximumJobTimelineBytes,
  maximumIndexedJobs,
  JobHistoryLimit,
  JobHistoryUnavailable,
  type JobHistoryPolicy,
  type JobHistoryUsage,
} from "./job-history-policy";
const migration = "job-history-size-census-v1";
const size = (expression: string) =>
  `COALESCE(length(CAST(${expression} AS BLOB)),0)`;
const requestSize =
  "COALESCE((SELECT sum(length(CAST(project_id AS BLOB))+length(CAST(request_key AS BLOB))+length(CAST(job_id AS BLOB))+length(CAST(request_version AS BLOB))) FROM export_requests WHERE job_id=j.id),0)";
const documentSize = `${size("j.data")}+${size("j.timeline")}+${requestSize}+COALESCE((SELECT length(CAST(manifest AS BLOB))+length(CAST(retired_data AS BLOB)) FROM job_history_retirements WHERE job_id=j.id),0)`;
const refresh = (id: string) =>
  `UPDATE job_history_sizes SET bytes=(SELECT ${documentSize} FROM jobs j WHERE j.id=job_history_sizes.job_id) WHERE job_id=${id} AND EXISTS(SELECT 1 FROM jobs WHERE id=${id});`;
const count = (value: unknown) => {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0)
    throw new JobHistoryUnavailable();
  return value;
};
type Totals = {
  bytes: number;
  reserved: number;
  full: number;
  retired: number;
};
function totals(db: Database.Database, workspaceId?: string): Totals {
  const value = db
    .prepare(
      `SELECT COALESCE(sum(s.bytes),0) AS bytes,COALESCE(sum(max(0,s.reservation_bytes-s.bytes)),0) AS reserved,COALESCE(sum(r.job_id IS NULL),0) AS full,COALESCE(sum(r.job_id IS NOT NULL),0) AS retired FROM job_history_sizes s LEFT JOIN job_history_retirements r ON r.job_id=s.job_id ${workspaceId === undefined ? "" : "WHERE s.workspace_id=?"}`,
    )
    .get(...(workspaceId === undefined ? [] : [workspaceId])) as Totals;
  Object.values(value).forEach(count);
  count(value.bytes + value.reserved);
  return value;
}
export function assertJobHistoryComplete(
  db: Database.Database,
  prospectiveJob?: string,
) {
  if (!db.prepare("SELECT 1 FROM schema_migrations WHERE id=?").get(migration))
    throw new JobHistoryUnavailable();
  if (
    db
      .prepare(
        "SELECT 1 FROM jobs j LEFT JOIN projects p ON p.id=j.project_id LEFT JOIN job_history_sizes s ON s.job_id=j.id WHERE p.id IS NULL OR s.job_id IS NULL OR s.project_id IS NOT j.project_id OR s.workspace_id IS NOT p.workspace_id LIMIT 1",
      )
      .get()
  )
    throw new JobHistoryUnavailable();
  if (
    db
      .prepare(
        "SELECT 1 FROM export_requests r LEFT JOIN jobs j ON j.id=r.job_id WHERE j.id IS NULL OR r.project_id IS NOT j.project_id LIMIT 1",
      )
      .get()
  )
    throw new JobHistoryUnavailable();
  if (
    db
      .prepare(
        `SELECT 1 FROM job_history_sizes s LEFT JOIN jobs j ON j.id=s.job_id WHERE j.id IS NULL ${prospectiveJob === undefined ? "" : "AND s.job_id<>?"} LIMIT 1`,
      )
      .get(...(prospectiveJob === undefined ? [] : [prospectiveJob]))
  )
    throw new JobHistoryUnavailable();
  if (
    db
      .prepare(
        "SELECT 1 FROM job_history_retirements r LEFT JOIN jobs j ON j.id=r.job_id LEFT JOIN projects p ON p.id=j.project_id WHERE j.id IS NULL OR r.project_id IS NOT j.project_id OR r.workspace_id IS NOT p.workspace_id OR j.data IS NOT r.retired_data OR j.timeline IS NOT 'null' LIMIT 1",
      )
      .get()
  )
    throw new JobHistoryUnavailable();
}
export function migrateJobHistoryStorage(db: Database.Database) {
  db.transaction(() => {
    db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations(id TEXT PRIMARY KEY,applied_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS export_requests(project_id TEXT NOT NULL,request_key TEXT NOT NULL,job_id TEXT NOT NULL,request_version TEXT NOT NULL,PRIMARY KEY(project_id,request_key));
      CREATE TABLE IF NOT EXISTS job_history_sizes(job_id TEXT PRIMARY KEY,project_id TEXT NOT NULL,workspace_id TEXT,bytes INTEGER NOT NULL CHECK(bytes>=0 AND bytes<=4398046511104),reservation_bytes INTEGER NOT NULL CHECK(reservation_bytes>=0 AND reservation_bytes<=${jobDocumentReservationBytes}));
      CREATE INDEX IF NOT EXISTS job_history_sizes_owner_idx ON job_history_sizes(workspace_id);
      CREATE TRIGGER IF NOT EXISTS history_job_insert_bound BEFORE INSERT ON jobs WHEN ${size("NEW.data")}>${maximumJobDocumentBytes} OR ${size("NEW.timeline")}>${maximumJobTimelineBytes} BEGIN SELECT RAISE(ABORT,'Job details exceed their captured document bound.'); END;
      CREATE TRIGGER IF NOT EXISTS history_job_insert_admission BEFORE INSERT ON jobs WHEN NEW.status IN ('queued','rendering') AND NOT EXISTS(SELECT 1 FROM job_history_sizes s JOIN projects p ON p.id=NEW.project_id WHERE s.job_id=NEW.id AND s.project_id=NEW.project_id AND s.workspace_id IS p.workspace_id AND s.reservation_bytes>0 AND p.trashed_at IS NULL AND NOT EXISTS(SELECT 1 FROM project_deletions d WHERE d.project_id=p.id)) BEGIN SELECT RAISE(ABORT,'A captured job history reservation is required before admission.'); END;
      CREATE TRIGGER IF NOT EXISTS history_job_render_admission BEFORE UPDATE OF status ON jobs WHEN NEW.status='rendering' AND NOT EXISTS(SELECT 1 FROM job_history_sizes s JOIN projects p ON p.id=NEW.project_id WHERE s.job_id=NEW.id AND s.project_id=NEW.project_id AND s.workspace_id IS p.workspace_id AND s.reservation_bytes>0 AND p.trashed_at IS NULL AND NOT EXISTS(SELECT 1 FROM project_deletions d WHERE d.project_id=p.id)) BEGIN SELECT RAISE(ABORT,'A captured job history reservation is required before rendering.'); END;
      CREATE TRIGGER IF NOT EXISTS history_job_document_growth BEFORE UPDATE OF data,timeline ON jobs WHEN (${size("NEW.data")}>${maximumJobDocumentBytes} AND ${size("NEW.data")}>${size("OLD.data")}) OR (${size("NEW.timeline")}>${maximumJobTimelineBytes} AND ${size("NEW.timeline")}>${size("OLD.timeline")}) BEGIN SELECT RAISE(ABORT,'Job details exceed their captured document bound.'); END;
      CREATE TRIGGER IF NOT EXISTS history_job_insert_size AFTER INSERT ON jobs BEGIN
        INSERT INTO job_history_sizes(job_id,project_id,workspace_id,bytes,reservation_bytes) SELECT j.id,j.project_id,p.workspace_id,${documentSize},0 FROM jobs j LEFT JOIN projects p ON p.id=j.project_id WHERE j.id=NEW.id ON CONFLICT(job_id) DO UPDATE SET bytes=excluded.bytes;
      END;
      CREATE TRIGGER IF NOT EXISTS history_job_update_size AFTER UPDATE OF data,timeline,status ON jobs BEGIN
        ${refresh("NEW.id")}
        UPDATE job_history_sizes SET reservation_bytes=0 WHERE job_id=NEW.id AND NEW.status IN ('completed','failed','cancelled') AND NOT EXISTS(SELECT 1 FROM render_job_attempts WHERE job_id=NEW.id);
      END;
      CREATE TRIGGER IF NOT EXISTS history_attempt_finished AFTER DELETE ON render_job_attempts WHEN EXISTS(SELECT 1 FROM jobs WHERE id=OLD.job_id AND status IN ('completed','failed','cancelled')) BEGIN UPDATE job_history_sizes SET reservation_bytes=0 WHERE job_id=OLD.job_id; END;
      CREATE TRIGGER IF NOT EXISTS history_job_deleted AFTER DELETE ON jobs BEGIN DELETE FROM export_requests WHERE job_id=OLD.id; DELETE FROM job_history_sizes WHERE job_id=OLD.id; END;
      CREATE TRIGGER IF NOT EXISTS history_job_move BEFORE UPDATE OF project_id ON jobs WHEN NEW.project_id IS NOT OLD.project_id AND EXISTS(SELECT 1 FROM job_history_sizes WHERE job_id=OLD.id) BEGIN SELECT RAISE(ABORT,'Job history ownership cannot change.'); END;
      CREATE TRIGGER IF NOT EXISTS history_project_owner AFTER UPDATE OF workspace_id ON projects WHEN NEW.workspace_id IS NOT OLD.workspace_id BEGIN UPDATE job_history_sizes SET workspace_id=NEW.workspace_id WHERE project_id=NEW.id; END;
      CREATE TRIGGER IF NOT EXISTS history_request_bound BEFORE INSERT ON export_requests WHEN NEW.project_id IS NOT (SELECT project_id FROM jobs WHERE id=NEW.job_id) OR ${size("NEW.project_id")}+${size("NEW.request_key")}+${size("NEW.job_id")}+${size("NEW.request_version")}+COALESCE((SELECT sum(length(CAST(project_id AS BLOB))+length(CAST(request_key AS BLOB))+length(CAST(job_id AS BLOB))+length(CAST(request_version AS BLOB))) FROM export_requests WHERE job_id=NEW.job_id),0)>4096 BEGIN SELECT RAISE(ABORT,'Job request receipt is outside its captured bound.'); END;
      CREATE TRIGGER IF NOT EXISTS history_request_insert AFTER INSERT ON export_requests BEGIN ${refresh("NEW.job_id")} END;
      CREATE TRIGGER IF NOT EXISTS history_request_delete AFTER DELETE ON export_requests BEGIN ${refresh("OLD.job_id")} END;
      CREATE TRIGGER IF NOT EXISTS history_request_immutable BEFORE UPDATE ON export_requests BEGIN SELECT RAISE(ABORT,'Job request receipts cannot change.'); END;
      CREATE TRIGGER IF NOT EXISTS history_retirement_insert AFTER INSERT ON job_history_retirements BEGIN ${refresh("NEW.job_id")} END;
    `);
    if (
      !db.prepare("SELECT 1 FROM schema_migrations WHERE id=?").get(migration)
    ) {
      const jobs = (
        db.prepare("SELECT count(*) AS n FROM jobs").get() as { n: number }
      ).n;
      if (
        jobs > maximumIndexedJobs ||
        db.prepare("SELECT 1 FROM job_history_sizes LIMIT 1").get()
      )
        throw new JobHistoryUnavailable();
      db.exec(
        `INSERT INTO job_history_sizes(job_id,project_id,workspace_id,bytes,reservation_bytes) SELECT j.id,j.project_id,p.workspace_id,${documentSize},CASE WHEN j.status IN ('queued','rendering') OR EXISTS(SELECT 1 FROM render_job_attempts WHERE job_id=j.id) THEN ${jobDocumentReservationBytes} ELSE 0 END FROM jobs j LEFT JOIN projects p ON p.id=j.project_id`,
      );
      db.prepare("INSERT INTO schema_migrations VALUES(?,?)").run(
        migration,
        new Date().toISOString(),
      );
    }
    assertJobHistoryComplete(db);
  }).immediate();
}
export function jobHistoryUsage(
  db: Database.Database,
  workspaceId: string,
  policy: JobHistoryPolicy,
): JobHistoryUsage {
  assertJobHistoryComplete(db);
  const t = totals(db, workspaceId);
  return {
    bytes: t.bytes,
    reservedBytes: t.reserved,
    fullJobs: t.full,
    retiredJobs: t.retired,
    limitBytes: policy.studioBytes,
    limitJobs: policy.studioJobs,
    limitRetired: policy.studioRetired,
    reservationBytes: jobDocumentReservationBytes,
  };
}
// Must share the caller's IMMEDIATE transaction with INSERT jobs and the export
// request receipt. The SQL insert guard also refuses older unbudgeted producers.
export function reserveJobHistory(
  db: Database.Database,
  jobId: string,
  projectId: string,
  workspaceId: string | null,
  policy: JobHistoryPolicy,
) {
  if (!db.inTransaction) throw new JobHistoryUnavailable();
  assertJobHistoryComplete(db);
  if (
    db
      .prepare(
        "SELECT 1 FROM jobs WHERE id=? UNION ALL SELECT 1 FROM job_history_sizes WHERE job_id=?",
      )
      .get(jobId, jobId)
  )
    throw new JobHistoryUnavailable();
  if (
    !db
      .prepare(
        "SELECT 1 FROM projects p WHERE p.id=? AND p.workspace_id IS ? AND p.trashed_at IS NULL AND NOT EXISTS(SELECT 1 FROM project_deletions WHERE project_id=p.id)",
      )
      .get(projectId, workspaceId)
  )
    throw new JobHistoryUnavailable();
  const own = workspaceId === null ? undefined : totals(db, workspaceId),
    shared = totals(db);
  if (own) {
    if (
      own.bytes + own.reserved + jobDocumentReservationBytes >
      policy.studioBytes
    )
      throw new JobHistoryLimit("studio", "bytes");
    if (own.full + 1 > policy.studioJobs)
      throw new JobHistoryLimit("studio", "jobs");
  }
  if (
    shared.bytes + shared.reserved + jobDocumentReservationBytes >
    policy.serviceBytes
  )
    throw new JobHistoryLimit("service", "bytes");
  if (
    shared.full + 1 > policy.serviceJobs ||
    shared.full + shared.retired + 1 > maximumIndexedJobs
  )
    throw new JobHistoryLimit("service", "jobs");
  db.prepare("INSERT INTO job_history_sizes VALUES(?,?,?,0,?)").run(
    jobId,
    projectId,
    workspaceId,
    jobDocumentReservationBytes,
  );
}
