import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import {
  exportFileManifest,
  ExportFileUnavailable,
  ExportFileBusy,
  ExportFileCapacity,
  type ExportFileManifest,
  type ExportFileRemoval,
  type ExportFileState,
} from "./export-file-policy";
type Row = {
  job_id: string;
  project_id: string;
  workspace_id: string;
  state: ExportFileState;
  requested_at: string;
  completed_at: string | null;
  attempts: number;
  available_at: number;
  token: string | null;
  error: string | null;
  manifest: string | null;
};
export type ExportFileTask = {
  jobId: string;
  projectId: string;
  workspaceId: string;
  token: string;
  manifest: ExportFileManifest;
  attempts: number;
};
const errorMessage =
  "Export cleanup could not finish safely. Review the current files and retry, or contact the studio operator. The files remain unavailable.";
const row = (db: Database.Database, id: string) =>
  db.prepare("SELECT * FROM export_file_removals WHERE job_id=?").get(id) as
    Row | undefined;
const receipt = (r: Row): ExportFileRemoval => ({
  jobId: r.job_id,
  projectId: r.project_id,
  state: r.state,
  requestedAt: r.requested_at,
  completedAt: r.completed_at,
  error: r.state === "failed" ? errorMessage : null,
});
export function migrateExportFileRemovals(db: Database.Database) {
  db.transaction(() =>
    db.exec(`
CREATE TABLE IF NOT EXISTS render_job_attempts(job_id TEXT PRIMARY KEY,started_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS export_file_removals(job_id TEXT PRIMARY KEY,project_id TEXT NOT NULL,workspace_id TEXT NOT NULL,state TEXT NOT NULL CHECK(state IN ('queued','working','failed','completed')),requested_at TEXT NOT NULL,completed_at TEXT,attempts INTEGER NOT NULL DEFAULT 0,available_at INTEGER NOT NULL DEFAULT 0,token TEXT,error TEXT,manifest TEXT);
CREATE TABLE IF NOT EXISTS export_file_reviews(token TEXT PRIMARY KEY,workspace_id TEXT NOT NULL,expires_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS export_file_removals_queue_idx ON export_file_removals(state,available_at);
CREATE INDEX IF NOT EXISTS export_file_removals_owner_idx ON export_file_removals(workspace_id,state);
CREATE TRIGGER IF NOT EXISTS removing_export_owner BEFORE UPDATE OF workspace_id ON projects WHEN NEW.workspace_id IS NOT OLD.workspace_id AND EXISTS(SELECT 1 FROM export_file_removals r WHERE r.project_id=OLD.id) BEGIN SELECT RAISE(ABORT,'Export cleanup ownership cannot change.'); END;
CREATE TRIGGER IF NOT EXISTS removing_export_move BEFORE UPDATE OF project_id ON jobs WHEN NEW.project_id IS NOT OLD.project_id AND EXISTS(SELECT 1 FROM export_file_removals r WHERE r.job_id=OLD.id) BEGIN SELECT RAISE(ABORT,'Export cleanup cannot move to another project.'); END;
CREATE TRIGGER IF NOT EXISTS removing_export_restart BEFORE UPDATE OF status ON jobs WHEN NEW.status IN ('queued','rendering') AND EXISTS(SELECT 1 FROM export_file_removals r WHERE r.job_id=OLD.id) BEGIN SELECT RAISE(ABORT,'Removed export files cannot be regenerated under this job.'); END;
CREATE TRIGGER IF NOT EXISTS removing_export_attempt BEFORE INSERT ON render_job_attempts WHEN EXISTS(SELECT 1 FROM export_file_removals r WHERE r.job_id=NEW.job_id) BEGIN SELECT RAISE(ABORT,'Export cleanup already owns this job.'); END;
CREATE TRIGGER IF NOT EXISTS export_cleanup_job_deleted AFTER DELETE ON jobs BEGIN DELETE FROM export_file_removals WHERE job_id=OLD.id; DELETE FROM render_job_attempts WHERE job_id=OLD.id; END;
`),
  ).immediate();
}
export function getExportFileRemoval(
  db: Database.Database,
  jobId: string,
  workspaceId?: string,
) {
  const found = row(db, jobId);
  return found &&
    (workspaceId === undefined || found.workspace_id === workspaceId)
    ? receipt(found)
    : undefined;
}
export function assertExportFileSource(
  db: Database.Database,
  jobId: string,
  workspaceId: string,
  active = true,
) {
  const found = db
    .prepare(
      `SELECT j.project_id AS projectId,j.status,EXISTS(SELECT 1 FROM render_job_attempts a WHERE a.job_id=j.id) AS processing FROM jobs j JOIN projects p ON p.id=j.project_id WHERE j.id=? AND p.workspace_id=? ${active ? "AND p.trashed_at IS NULL AND NOT EXISTS(SELECT 1 FROM project_deletions d WHERE d.project_id=p.id)" : ""}`,
    )
    .get(jobId, workspaceId) as
    { projectId: string; status: string; processing: number } | undefined;
  if (!found) return;
  if (
    !["completed", "failed", "cancelled"].includes(found.status) ||
    found.processing
  )
    throw new ExportFileBusy();
  return found;
}
export function requestExportFileRemoval(
  db: Database.Database,
  manifest: ExportFileManifest,
  now = Date.now(),
) {
  manifest = exportFileManifest.parse(manifest);
  return db
    .transaction(() => {
      const source = assertExportFileSource(
        db,
        manifest.jobId,
        manifest.workspaceId,
      );
      if (!source || source.projectId !== manifest.projectId) return;
      const previous = row(db, manifest.jobId);
      if (previous) {
        if (
          previous.workspace_id !== manifest.workspaceId ||
          previous.project_id !== manifest.projectId
        )
          throw new ExportFileUnavailable();
        if (previous.state !== "failed") return receipt(previous);
      }
      const studio = (
        db
          .prepare(
            "SELECT count(*) AS count FROM export_file_removals WHERE workspace_id=? AND state IN ('queued','working')",
          )
          .get(manifest.workspaceId) as { count: number }
      ).count;
      const shared = (
        db
          .prepare(
            "SELECT count(*) AS count FROM export_file_removals WHERE state IN ('queued','working')",
          )
          .get() as { count: number }
      ).count;
      if (studio >= 5) throw new ExportFileCapacity("studio");
      if (shared >= 50) throw new ExportFileCapacity("service");
      const encoded = JSON.stringify(manifest);
      if (Buffer.byteLength(encoded) > 1024 ** 2)
        throw new ExportFileUnavailable();
      db.prepare(
        `INSERT INTO export_file_removals(job_id,project_id,workspace_id,state,requested_at,manifest) VALUES(?,?,?,'queued',?,?) ON CONFLICT(job_id) DO UPDATE SET state='queued',attempts=0,available_at=0,token=NULL,completed_at=NULL,error=NULL,manifest=excluded.manifest`,
      ).run(
        manifest.jobId,
        manifest.projectId,
        manifest.workspaceId,
        new Date(now).toISOString(),
        encoded,
      );
      return receipt(row(db, manifest.jobId)!);
    })
    .immediate();
}
export function claimExportFileRemoval(
  db: Database.Database,
  now = Date.now(),
): ExportFileTask | undefined {
  return db
    .transaction(() => {
      const found = db
        .prepare(
          "SELECT * FROM export_file_removals WHERE state IN ('queued','failed') AND attempts<3 AND available_at<=? ORDER BY requested_at,job_id LIMIT 1",
        )
        .get(now) as Row | undefined;
      if (!found) return;
      let manifest: ExportFileManifest;
      try {
        if (!found.manifest || Buffer.byteLength(found.manifest) > 1024 ** 2)
          throw new Error();
        manifest = exportFileManifest.parse(JSON.parse(found.manifest));
        if (
          manifest.jobId !== found.job_id ||
          manifest.projectId !== found.project_id ||
          manifest.workspaceId !== found.workspace_id
        )
          throw new Error();
        const source = assertExportFileSource(
          db,
          found.job_id,
          found.workspace_id,
          false,
        );
        if (!source || source.projectId !== found.project_id) throw new Error();
      } catch {
        db.prepare(
          "UPDATE export_file_removals SET state='failed',attempts=3,error=?,token=NULL WHERE job_id=?",
        ).run(errorMessage, found.job_id);
        return;
      }
      const token = randomUUID();
      db.prepare(
        "UPDATE export_file_removals SET state='working',attempts=attempts+1,token=?,error=NULL WHERE job_id=?",
      ).run(token, found.job_id);
      return {
        jobId: found.job_id,
        projectId: found.project_id,
        workspaceId: found.workspace_id,
        token,
        manifest,
        attempts: found.attempts + 1,
      };
    })
    .immediate();
}
export function finishExportFileRemoval(
  db: Database.Database,
  task: ExportFileTask,
  now = Date.now(),
) {
  return db
    .transaction(() => {
      const found = row(db, task.jobId);
      if (
        !found ||
        found.state !== "working" ||
        found.token !== task.token ||
        found.workspace_id !== task.workspaceId ||
        found.project_id !== task.projectId
      )
        throw new ExportFileUnavailable();
      const source = assertExportFileSource(
        db,
        task.jobId,
        task.workspaceId,
        false,
      );
      if (!source || source.projectId !== task.projectId)
        throw new ExportFileUnavailable();
      db.prepare(
        "UPDATE export_file_removals SET state='completed',completed_at=?,token=NULL,manifest=NULL,error=NULL WHERE job_id=?",
      ).run(new Date(now).toISOString(), task.jobId);
      return receipt(row(db, task.jobId)!);
    })
    .immediate();
}
export function failExportFileRemoval(
  db: Database.Database,
  task: ExportFileTask,
  now = Date.now(),
) {
  db.prepare(
    "UPDATE export_file_removals SET state='failed',token=NULL,error=?,available_at=? WHERE job_id=? AND state='working' AND token=?",
  ).run(
    errorMessage,
    now + Math.min(60000, 1000 * 2 ** task.attempts),
    task.jobId,
    task.token,
  );
}
// Only after the lifetime kernel lock and native-process recovery guard.
export function recoverExportFileRemovals(db: Database.Database) {
  db.exec(
    "UPDATE export_file_removals SET state='queued',token=NULL WHERE state='working'; DELETE FROM render_job_attempts;",
  );
}
export function acquireExportFileReview(
  db: Database.Database,
  workspaceId: string,
  now = Date.now(),
) {
  return db
    .transaction(() => {
      db.prepare("DELETE FROM export_file_reviews WHERE expires_at<=?").run(
        now,
      );
      if (
        db
          .prepare("SELECT 1 FROM export_file_reviews WHERE workspace_id=?")
          .get(workspaceId)
      )
        throw new ExportFileCapacity("studio");
      if (
        (
          db
            .prepare("SELECT count(*) AS count FROM export_file_reviews")
            .get() as { count: number }
        ).count >= 2
      )
        throw new ExportFileCapacity("service");
      const token = randomUUID();
      db.prepare("INSERT INTO export_file_reviews VALUES(?,?,?)").run(
        token,
        workspaceId,
        now + 30000,
      );
      return token;
    })
    .immediate();
}
export function releaseExportFileReview(db: Database.Database, token: string) {
  db.prepare("DELETE FROM export_file_reviews WHERE token=?").run(token);
}
const hasTable = (db: Database.Database, name: string) =>
  !!db
    .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?")
    .get(name);
export function snapshotRemovedExportIds(db: Database.Database) {
  const result = new Set<string>();
  if (!hasTable(db, "export_file_removals")) return result;
  const rows = db
    .prepare(
      `SELECT r.job_id,r.project_id,r.workspace_id,r.state,r.requested_at,j.project_id AS owner_project,j.status,p.workspace_id AS owner_workspace FROM export_file_removals r LEFT JOIN jobs j ON j.id=r.job_id LEFT JOIN projects p ON p.id=j.project_id`,
    )
    .all() as {
    job_id: string;
    project_id: string;
    workspace_id: string;
    state: string;
    requested_at: string;
    owner_project: string | null;
    status: string | null;
    owner_workspace: string | null;
  }[];
  for (const r of rows) {
    if (
      !/^[a-f0-9-]{36}$/.test(r.job_id) ||
      r.project_id !== r.owner_project ||
      r.workspace_id !== r.owner_workspace ||
      !["queued", "working", "failed", "completed"].includes(r.state) ||
      !["completed", "failed", "cancelled"].includes(r.status ?? "") ||
      !Number.isFinite(Date.parse(r.requested_at))
    )
      throw new ExportFileUnavailable();
    result.add(r.job_id);
  }
  return result;
}
// Pass only a copied offline snapshot, never the live database.
export function normalizeExportFileRemovalSnapshot(db: Database.Database) {
  return db
    .transaction(() => {
      const removed = snapshotRemovedExportIds(db);
      if (hasTable(db, "export_file_removals"))
        db.prepare(
          "UPDATE export_file_removals SET state='completed',completed_at=COALESCE(completed_at,?),token=NULL,manifest=NULL,error=NULL",
        ).run(new Date().toISOString());
      for (const table of ["render_job_attempts", "export_file_reviews"])
        if (hasTable(db, table)) db.exec(`DELETE FROM ${table}`);
      return removed;
    })
    .immediate();
}
