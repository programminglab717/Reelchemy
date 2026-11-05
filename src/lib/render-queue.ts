import type Database from "better-sqlite3";

// Shared single-consumer render queue order. Each admitted export receives a
// fixed virtual finish key: the later of its admission time and its studio's
// latest pending key, plus its film running time. The consumer claims the
// smallest key. One studio's consecutive long films therefore queue behind
// each other rather than ahead of every other studio, shorter work is not held
// behind unrelated long films, and keys never change after admission, so later
// arrivals eventually rank behind any waiting job (no starvation). A studio's
// own exports keep their admission order. Legacy queued jobs without a key keep
// rowid order ahead of keyed work.
export function migrateRenderQueue(db: Database.Database) {
  db.transaction(() =>
    db.exec(`
CREATE TABLE IF NOT EXISTS render_queue_keys(job_id TEXT PRIMARY KEY,queue_key INTEGER NOT NULL CHECK(queue_key>=0));
CREATE TRIGGER IF NOT EXISTS render_queue_job_finished AFTER UPDATE OF status ON jobs WHEN NEW.status IN ('completed','failed','cancelled') BEGIN DELETE FROM render_queue_keys WHERE job_id=NEW.id; END;
CREATE TRIGGER IF NOT EXISTS render_queue_job_deleted AFTER DELETE ON jobs BEGIN DELETE FROM render_queue_keys WHERE job_id=OLD.id; END;
`),
  ).immediate();
}
// Runs inside the admission transaction, after the job row exists.
export function assignRenderQueueKey(
  db: Database.Database,
  jobId: string,
  workspaceId: string | null,
  frames: number,
  now = Date.now(),
) {
  const pending = db
    .prepare(
      `SELECT max(k.queue_key) AS key FROM render_queue_keys k JOIN jobs j ON j.id=k.job_id LEFT JOIN projects p ON p.id=j.project_id WHERE j.id<>? AND j.status IN ('queued','rendering') AND p.workspace_id IS ?`,
    )
    .get(jobId, workspaceId) as { key: number | null };
  const key =
    Math.max(now, pending.key ?? 0) +
    Math.ceil((Math.max(0, frames) * 1000) / 30);
  db.prepare("INSERT INTO render_queue_keys(job_id,queue_key) VALUES(?,?)").run(
    jobId,
    key,
  );
  return key;
}
export const renderQueueOrder =
  "coalesce((SELECT k.queue_key FROM render_queue_keys k WHERE k.job_id=jobs.id),0),jobs.rowid";
// Exports that will be worked on before this queued job at the current order:
// whatever is rendering plus queued work ranked ahead. Counts only; no other
// studio's identifiers or details. New shorter work can still rank ahead.
export function renderQueueAhead(db: Database.Database, jobId: string) {
  const row = db
    .prepare(
      `WITH ranked AS (SELECT jobs.id, row_number() OVER (ORDER BY ${renderQueueOrder}) AS position FROM jobs WHERE status='queued')
       SELECT (SELECT position FROM ranked WHERE id=?) AS position,
              (SELECT count(*) FROM jobs WHERE status='rendering') AS rendering`,
    )
    .get(jobId) as { position: number | null; rendering: number };
  return row.position === null ? undefined : row.position - 1 + row.rendering;
}
