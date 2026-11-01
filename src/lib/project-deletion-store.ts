import type Database from "better-sqlite3";
import { z } from "zod";
import { mediaReferencedOutsideProject } from "./media-references";
import { ProjectDeletionConflict } from "./project-deletion-policy";
import { migrateMediaProcessing } from "./media-processing-store";

const manifestSchema = z.object({
  assets: z.array(z.uuid()).max(100000),
  jobs: z.array(z.uuid()).max(100000),
});
export type DeletionManifest = z.infer<typeof manifestSchema>;
export type ProjectDeletionState =
  "queued" | "working" | "failed" | "completed";
export type ProjectDeletion = {
  projectId: string;
  name: string | null;
  state: ProjectDeletionState;
  requestedAt: string;
  completedAt: string | null;
  error: string | null;
};
type Row = {
  project_id: string;
  workspace_id: string;
  name: string | null;
  state: ProjectDeletionState;
  requested_at: string;
  completed_at: string | null;
  attempts: number;
  available_at: number;
  error: string | null;
  manifest: string | null;
};
export type DeletionTask = {
  projectId: string;
  workspaceId: string;
  manifest: DeletionManifest;
  attempts: number;
};
const failedMessage =
  "Project cleanup could not finish. Retry it or contact the studio operator. The project remains hidden.";
const reviewMessage =
  "Project cleanup needs operator review. The project remains hidden.";
function publicRow(row: Row): ProjectDeletion {
  return {
    projectId: row.project_id,
    name: row.name,
    state: row.state,
    requestedAt: row.requested_at,
    completedAt: row.completed_at,
    error: row.error,
  };
}
function rowFor(db: Database.Database, id: string) {
  return db
    .prepare("SELECT * FROM project_deletions WHERE project_id=?")
    .get(id) as Row | undefined;
}
function assertSource(db: Database.Database, row: Row) {
  const project = db
    .prepare("SELECT workspace_id,trashed_at FROM projects WHERE id=?")
    .get(row.project_id) as
    { workspace_id: string | null; trashed_at: string | null } | undefined;
  if (
    !project ||
    project.workspace_id !== row.workspace_id ||
    !project.trashed_at
  )
    throw new ProjectDeletionConflict(reviewMessage);
}
export function migrateProjectDeletions(db: Database.Database) {
  db.transaction(() => {
    migrateMediaProcessing(db);
    db.exec(
      "CREATE TABLE IF NOT EXISTS schema_migrations(id TEXT PRIMARY KEY,applied_at TEXT NOT NULL)",
    );
    const migration = "project-deletion-guards-v1";
    const initialize = !db
      .prepare("SELECT id FROM schema_migrations WHERE id=?")
      .get(migration);
    if (initialize)
      db.exec(`
      DROP TRIGGER IF EXISTS deleting_project_insert;
      DROP TRIGGER IF EXISTS deleting_project_update;
      DROP TRIGGER IF EXISTS deleting_project_job_insert;
      DROP TRIGGER IF EXISTS deleting_project_job_move;
      DROP TRIGGER IF EXISTS deleting_media_project_reference;
      DROP TRIGGER IF EXISTS deleting_media_job_reference;
    `);
    db.exec(`
    CREATE TABLE IF NOT EXISTS project_deletions(project_id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL,name TEXT,state TEXT NOT NULL CHECK(state IN ('queued','working','failed','completed')),requested_at TEXT NOT NULL,completed_at TEXT,attempts INTEGER NOT NULL DEFAULT 0,available_at INTEGER NOT NULL DEFAULT 0,error TEXT,manifest TEXT);
    CREATE INDEX IF NOT EXISTS project_deletions_owner_idx ON project_deletions(workspace_id,state);
    CREATE INDEX IF NOT EXISTS project_deletions_queue_idx ON project_deletions(state,available_at);
    CREATE TABLE IF NOT EXISTS media_deletion_targets(asset_id TEXT PRIMARY KEY,project_id TEXT NOT NULL);
    CREATE TRIGGER IF NOT EXISTS deleting_project_insert BEFORE INSERT ON projects WHEN EXISTS(SELECT 1 FROM project_deletions WHERE project_id=NEW.id) BEGIN
      SELECT RAISE(ABORT,'Project is scheduled for permanent deletion.');
    END;
    CREATE TRIGGER IF NOT EXISTS deleting_project_update BEFORE UPDATE OF data,trashed_at ON projects WHEN EXISTS(SELECT 1 FROM project_deletions WHERE project_id=OLD.id) BEGIN
      SELECT RAISE(ABORT,'Project is scheduled for permanent deletion.');
    END;
    CREATE TRIGGER IF NOT EXISTS deleting_project_job_insert BEFORE INSERT ON jobs WHEN EXISTS(SELECT 1 FROM project_deletions WHERE project_id=NEW.project_id) BEGIN
      SELECT RAISE(ABORT,'Project is scheduled for permanent deletion.');
    END;
    CREATE TRIGGER IF NOT EXISTS deleting_project_job_move BEFORE UPDATE OF project_id ON jobs WHEN EXISTS(SELECT 1 FROM project_deletions WHERE project_id=NEW.project_id OR project_id=OLD.project_id) BEGIN
      SELECT RAISE(ABORT,'Project is scheduled for permanent deletion.');
    END;
    CREATE TRIGGER IF NOT EXISTS deleting_media_project_reference BEFORE INSERT ON project_media_refs WHEN EXISTS(SELECT 1 FROM media_deletion_targets WHERE asset_id=NEW.asset_id) BEGIN
      SELECT RAISE(ABORT,'Media is scheduled for permanent deletion.');
    END;
    CREATE TRIGGER IF NOT EXISTS deleting_media_job_reference BEFORE INSERT ON job_media_refs WHEN EXISTS(SELECT 1 FROM media_deletion_targets WHERE asset_id=NEW.asset_id) BEGIN
      SELECT RAISE(ABORT,'Media is scheduled for permanent deletion.');
    END;
  `);
    if (initialize)
      db.prepare(
        "INSERT INTO schema_migrations(id,applied_at) VALUES (?,?)",
      ).run(migration, new Date().toISOString());
  }).immediate();
}
export function getProjectDeletion(
  db: Database.Database,
  id: string,
  workspaceId: string,
) {
  const row = rowFor(db, id);
  return row?.workspace_id === workspaceId ? publicRow(row) : undefined;
}
export function listProjectDeletions(
  db: Database.Database,
  workspaceId: string,
  offset = 0,
) {
  const start = Number.isSafeInteger(offset) && offset >= 0 ? offset : 0;
  const where = "workspace_id=? AND state<>'completed'";
  const total = (
    db
      .prepare(`SELECT count(*) AS count FROM project_deletions WHERE ${where}`)
      .get(workspaceId) as { count: number }
  ).count;
  // Never move manifests, other studio IDs or filesystem targets to the client.
  const rows = db
    .prepare(
      `SELECT project_id,name,state,requested_at,completed_at,error FROM project_deletions WHERE ${where} ORDER BY requested_at DESC LIMIT 20 OFFSET ?`,
    )
    .all(workspaceId, start) as Row[];
  return {
    requests: rows.map(publicRow),
    total,
    nextOffset: start + rows.length < total ? start + rows.length : null,
  };
}
export function requestProjectDeletion(
  db: Database.Database,
  id: string,
  workspaceId: string,
) {
  return db
    .transaction(() => {
      const existing = rowFor(db, id);
      if (existing) {
        if (existing.workspace_id !== workspaceId) return undefined;
        if (existing.state === "failed") {
          assertSource(db, existing);
          db.prepare(
            "UPDATE project_deletions SET state='queued',attempts=0,available_at=0,error=NULL WHERE project_id=?",
          ).run(id);
        }
        return publicRow(rowFor(db, id)!);
      }
      const project = db
        .prepare(
          "SELECT workspace_id,trashed_at,json_extract(data,'$.name') AS name FROM projects WHERE id=?",
        )
        .get(id) as
        | {
            workspace_id: string | null;
            trashed_at: string | null;
            name: unknown;
          }
        | undefined;
      if (!project || project.workspace_id !== workspaceId) return undefined;
      if (!project.trashed_at) throw new ProjectDeletionConflict();
      if (
        !z.uuid().safeParse(id).success ||
        !z.uuid().safeParse(workspaceId).success
      )
        throw new ProjectDeletionConflict(reviewMessage);
      const assets = (
        db
          .prepare(
            `SELECT asset_id FROM project_media_refs WHERE project_id=? UNION SELECT r.asset_id FROM job_media_refs r JOIN jobs j ON j.id=r.job_id WHERE j.project_id=?`,
          )
          .all(id, id) as { asset_id: string }[]
      ).map((r) => r.asset_id);
      const jobs = (
        db.prepare("SELECT id FROM jobs WHERE project_id=?").all(id) as {
          id: string;
        }[]
      ).map((r) => r.id);
      let manifest: DeletionManifest;
      try {
        manifest = manifestSchema.parse({ assets, jobs });
      } catch {
        throw new ProjectDeletionConflict(reviewMessage);
      }
      db.prepare(
        "UPDATE jobs SET status='cancelled',data=json_set(data,'$.status','cancelled','$.stage','Cancelled by permanent project deletion') WHERE project_id=? AND status IN ('queued','rendering')",
      ).run(id);
      db.prepare(
        "UPDATE media_requests SET state='cancelling',updated_at=? WHERE project_id=? AND state IN ('receiving','queued','working')",
      ).run(Date.now(), id);
      db.prepare(
        "INSERT INTO project_deletions(project_id,workspace_id,name,state,requested_at,manifest) VALUES (?,?,?,'queued',?,?)",
      ).run(
        id,
        workspaceId,
        typeof project.name === "string"
          ? project.name.slice(0, 160)
          : "Untitled project",
        new Date().toISOString(),
        JSON.stringify(manifest),
      );
      return publicRow(rowFor(db, id)!);
    })
    .immediate();
}
export function claimProjectDeletion(
  db: Database.Database,
  now = Date.now(),
): DeletionTask | undefined {
  return db
    .transaction(() => {
      const row = db
        .prepare(
          "SELECT * FROM project_deletions d WHERE (state='working' OR (state='queued' AND available_at<=?)) AND NOT EXISTS(SELECT 1 FROM media_requests m WHERE m.project_id=d.project_id AND (m.state IN ('receiving','queued','working','cancelling') OR m.reserved_bytes>0 OR m.outputs<>'[]')) ORDER BY requested_at LIMIT 1",
        )
        .get(now) as Row | undefined;
      if (!row) return undefined;
      let manifest: DeletionManifest;
      try {
        z.uuid().parse(row.project_id);
        z.uuid().parse(row.workspace_id);
        assertSource(db, row);
        manifest = manifestSchema.parse(JSON.parse(row.manifest || "null"));
      } catch {
        db.prepare(
          "UPDATE project_deletions SET state='failed',error=? WHERE project_id=?",
        ).run(reviewMessage, row.project_id);
        return undefined;
      }
      const attempts =
        row.state === "working" ? Math.max(1, row.attempts) : row.attempts + 1;
      db.prepare(
        "UPDATE project_deletions SET state='working',attempts=?,available_at=0,error=NULL WHERE project_id=?",
      ).run(attempts, row.project_id);
      return {
        projectId: row.project_id,
        workspaceId: row.workspace_id,
        manifest,
        attempts,
      };
    })
    .immediate();
}
export function reserveDeletionMedia(
  db: Database.Database,
  task: DeletionTask,
) {
  return db
    .transaction(() => {
      const row = rowFor(db, task.projectId);
      if (
        !row ||
        row.state !== "working" ||
        row.workspace_id !== task.workspaceId
      )
        throw new ProjectDeletionConflict(reviewMessage);
      assertSource(db, row);
      const manifest = manifestSchema.parse(JSON.parse(row.manifest || "null"));
      const reserved: string[] = [];
      for (const id of manifest.assets) {
        if (mediaReferencedOutsideProject(db, id, task.projectId)) {
          db.prepare(
            "DELETE FROM media_deletion_targets WHERE asset_id=? AND project_id=?",
          ).run(id, task.projectId);
          continue;
        }
        db.prepare(
          "INSERT OR IGNORE INTO media_deletion_targets(asset_id,project_id) VALUES (?,?)",
        ).run(id, task.projectId);
        const target = db
          .prepare(
            "SELECT project_id FROM media_deletion_targets WHERE asset_id=?",
          )
          .get(id) as { project_id: string };
        if (target.project_id === task.projectId) reserved.push(id);
      }
      return reserved;
    })
    .immediate();
}
export function failProjectDeletion(
  db: Database.Database,
  task: DeletionTask,
  now = Date.now(),
) {
  db.prepare(
    "UPDATE project_deletions SET state=?,available_at=?,error=? WHERE project_id=? AND workspace_id=? AND state='working'",
  ).run(
    task.attempts >= 3 ? "failed" : "queued",
    now + task.attempts * 5000,
    failedMessage,
    task.projectId,
    task.workspaceId,
  );
}
export function finishProjectDeletion(
  db: Database.Database,
  task: DeletionTask,
) {
  // Reduces remnants in the active SQLite file. Backups/OS snapshots/previously
  // downloaded copies have their own retention; this is not a forensic wipe.
  db.pragma("secure_delete = ON");
  const result = db
    .transaction(() => {
      const row = rowFor(db, task.projectId);
      if (
        !row ||
        row.state !== "working" ||
        row.workspace_id !== task.workspaceId
      )
        throw new ProjectDeletionConflict(reviewMessage);
      assertSource(db, row);
      if (
        db
          .prepare(
            "SELECT 1 FROM media_requests WHERE project_id=? AND (state IN ('receiving','queued','working','cancelling') OR reserved_bytes>0 OR outputs<>'[]') LIMIT 1",
          )
          .get(task.projectId)
      )
        throw new ProjectDeletionConflict(reviewMessage);
      db.prepare("DELETE FROM export_requests WHERE project_id=?").run(
        task.projectId,
      );
      db.prepare("DELETE FROM jobs WHERE project_id=?").run(task.projectId);
      db.prepare("DELETE FROM projects WHERE id=?").run(task.projectId);
      db.prepare(
        "DELETE FROM media_requests WHERE project_id=? OR (operation='import' AND result_id=?)",
      ).run(task.projectId, task.projectId);
      db.prepare(
        "DELETE FROM media_sizes WHERE asset_id IN (SELECT asset_id FROM media_deletion_targets WHERE project_id=?)",
      ).run(task.projectId);
      db.prepare("DELETE FROM media_deletion_targets WHERE project_id=?").run(
        task.projectId,
      );
      db.prepare(
        "UPDATE project_deletions SET state='completed',completed_at=?,name=NULL,manifest=NULL,error=NULL,available_at=0 WHERE project_id=?",
      ).run(new Date().toISOString(), task.projectId);
      return publicRow(rowFor(db, task.projectId)!);
    })
    .immediate();
  try {
    db.pragma("wal_checkpoint(TRUNCATE)");
  } catch {
    /* Active readers can delay checkpointing. */
  }
  return result;
}

// Call ONLY on the newly created, private backup database, never on live
// storage: honor pending erasure intent without resurrecting it after restore.
export function omitPendingDeletionsFromSnapshot(db: Database.Database) {
  if (
    !db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='project_deletions'",
      )
      .get()
  )
    return 0;
  db.pragma("secure_delete = ON");
  const omitted = db
    .transaction(() => {
      const rows = db
        .prepare("SELECT * FROM project_deletions WHERE state<>'completed'")
        .all() as Row[];
      for (const row of rows) {
        assertSource(db, row);
        db.prepare("DELETE FROM export_requests WHERE project_id=?").run(
          row.project_id,
        );
        db.prepare("DELETE FROM jobs WHERE project_id=?").run(row.project_id);
        db.prepare("DELETE FROM projects WHERE id=?").run(row.project_id);
        if (
          db
            .prepare(
              "SELECT 1 FROM sqlite_master WHERE type='table' AND name='media_requests'",
            )
            .get()
        )
          db.prepare(
            "DELETE FROM media_requests WHERE project_id=? OR (operation='import' AND result_id=?)",
          ).run(row.project_id, row.project_id);
        db.prepare("DELETE FROM media_deletion_targets WHERE project_id=?").run(
          row.project_id,
        );
        db.prepare(
          "UPDATE project_deletions SET state='completed',completed_at=?,name=NULL,manifest=NULL,error=NULL,available_at=0 WHERE project_id=?",
        ).run(new Date().toISOString(), row.project_id);
      }
      if (rows.length)
        db.exec(
          "DELETE FROM media_sizes WHERE asset_id NOT IN (SELECT asset_id FROM project_media_refs UNION SELECT asset_id FROM job_media_refs)",
        );
      return rows.length;
    })
    .immediate();
  if (omitted) db.exec("VACUUM");
  return omitted;
}
