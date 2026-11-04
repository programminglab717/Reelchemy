import type Database from "better-sqlite3";
import { z } from "zod";
import { JobHistoryUnavailable } from "./job-history-policy";

const boundedId = (maximum: number) =>
  z
    .string()
    .min(1)
    .max(maximum)
    .regex(/^[^\x00-\x1f\x7f]+$/);
export const retiredJobManifest = z
  .object({
    format: z.literal("reelchemy-retired-export-v1"),
    jobId: z.uuid(),
    projectId: boundedId(160),
    workspaceId: boundedId(80),
    retiredAt: z.iso.datetime({ offset: true }),
    digest: z.string().regex(/^[a-f0-9]{64}$/),
    sourceIds: z.array(z.uuid()).max(1024),
  })
  .strict()
  .refine(
    (value) =>
      value.sourceIds.every(
        (id, index) => index === 0 || value.sourceIds[index - 1] < id,
      ),
    "Sources must be unique and sorted.",
  );
export type RetiredJobManifest = z.infer<typeof retiredJobManifest>;
export function migrateJobHistoryReferences(db: Database.Database) {
  db.transaction(() =>
    db.exec(`
    CREATE TABLE IF NOT EXISTS job_history_retirements(
      job_id TEXT PRIMARY KEY,project_id TEXT NOT NULL,workspace_id TEXT NOT NULL,
      manifest TEXT NOT NULL CHECK(json_valid(manifest)),
      retired_data TEXT NOT NULL CHECK(length(CAST(retired_data AS BLOB))<=8192 AND json_valid(retired_data))
    );
    CREATE INDEX IF NOT EXISTS job_history_retirements_owner_idx ON job_history_retirements(workspace_id);
    CREATE TRIGGER IF NOT EXISTS retired_history_context BEFORE INSERT ON job_history_retirements
    WHEN NOT EXISTS(SELECT 1 FROM jobs j JOIN projects p ON p.id=j.project_id WHERE j.id=NEW.job_id AND j.project_id=NEW.project_id AND p.workspace_id=NEW.workspace_id)
      OR json_extract(NEW.manifest,'$.jobId') IS NOT NEW.job_id
      OR json_extract(NEW.manifest,'$.projectId') IS NOT NEW.project_id
      OR json_extract(NEW.manifest,'$.workspaceId') IS NOT NEW.workspace_id
      OR json_type(NEW.manifest,'$.sourceIds') IS NOT 'array'
      OR json_extract(NEW.retired_data,'$.id') IS NOT NEW.job_id
      OR json_extract(NEW.retired_data,'$.projectId') IS NOT NEW.project_id
      OR json_extract(NEW.retired_data,'$.status') IS NOT (SELECT status FROM jobs WHERE id=NEW.job_id)
      OR (SELECT status FROM jobs WHERE id=NEW.job_id) NOT IN ('completed','failed','cancelled')
    BEGIN SELECT RAISE(ABORT,'Retired export source context cannot change.'); END;
    CREATE TRIGGER IF NOT EXISTS retired_history_exact_sources BEFORE INSERT ON job_history_retirements
    WHEN EXISTS(SELECT asset_id FROM job_media_refs WHERE job_id=NEW.job_id EXCEPT SELECT value FROM json_each(NEW.manifest,'$.sourceIds'))
      OR EXISTS(SELECT value FROM json_each(NEW.manifest,'$.sourceIds') EXCEPT SELECT asset_id FROM job_media_refs WHERE job_id=NEW.job_id)
    BEGIN SELECT RAISE(ABORT,'Retired export source references must match.'); END;
    CREATE TRIGGER IF NOT EXISTS retired_history_immutable BEFORE UPDATE ON job_history_retirements
    BEGIN SELECT RAISE(ABORT,'Retired export source context cannot change.'); END;
    CREATE TRIGGER IF NOT EXISTS retired_history_delete BEFORE DELETE ON job_history_retirements
    WHEN EXISTS(SELECT 1 FROM jobs WHERE id=OLD.job_id)
    BEGIN SELECT RAISE(ABORT,'Retired export source references must be retained.'); END;
    CREATE TRIGGER IF NOT EXISTS retired_history_job_immutable BEFORE UPDATE OF data,timeline,status,project_id ON jobs
    WHEN EXISTS(SELECT 1 FROM job_history_retirements WHERE job_id=OLD.id)
      AND ((NEW.data IS NOT OLD.data AND NEW.data IS NOT (SELECT retired_data FROM job_history_retirements WHERE job_id=OLD.id))
        OR (NEW.timeline IS NOT OLD.timeline AND NEW.timeline IS NOT 'null')
        OR NEW.status IS NOT OLD.status OR NEW.project_id IS NOT OLD.project_id)
    BEGIN SELECT RAISE(ABORT,'Retired export details cannot be regenerated.'); END;
    CREATE TRIGGER IF NOT EXISTS retired_history_owner_immutable BEFORE UPDATE OF workspace_id ON projects
    WHEN NEW.workspace_id IS NOT OLD.workspace_id AND EXISTS(SELECT 1 FROM job_history_retirements WHERE project_id=OLD.id)
    BEGIN SELECT RAISE(ABORT,'Retired export ownership cannot change.'); END;
    CREATE TRIGGER IF NOT EXISTS retired_history_source_delete BEFORE DELETE ON job_media_refs
    WHEN EXISTS(SELECT 1 FROM jobs WHERE id=OLD.job_id)
      AND EXISTS(SELECT 1 FROM job_history_retirements r,json_each(r.manifest,'$.sourceIds') s WHERE r.job_id=OLD.job_id AND s.value=OLD.asset_id)
    BEGIN SELECT RAISE(ABORT,'Retired export source references must be retained.'); END;
    CREATE TRIGGER IF NOT EXISTS retired_history_job_deleted AFTER DELETE ON jobs
    BEGIN DELETE FROM job_history_retirements WHERE job_id=OLD.id; DELETE FROM job_media_refs WHERE job_id=OLD.id; END;
  `),
  ).immediate();
}
export function readRetiredJob(
  db: Database.Database,
  jobId: string,
): RetiredJobManifest | undefined {
  const row = db
    .prepare(
      "SELECT r.project_id,r.workspace_id,CASE WHEN length(CAST(r.manifest AS BLOB))<=65536 THEN r.manifest ELSE NULL END AS manifest,j.project_id AS job_project,p.workspace_id AS job_workspace,j.data IS r.retired_data AND j.timeline='null' AS normalized FROM job_history_retirements r LEFT JOIN jobs j ON j.id=r.job_id LEFT JOIN projects p ON p.id=j.project_id WHERE r.job_id=?",
    )
    .get(jobId) as
    | {
        project_id: string;
        workspace_id: string;
        manifest: string | null;
        job_project: string | null;
        job_workspace: string | null;
        normalized: number | null;
      }
    | undefined;
  if (!row) return;
  try {
    const value = retiredJobManifest.parse(JSON.parse(row.manifest!));
    if (
      value.jobId !== jobId ||
      value.projectId !== row.project_id ||
      value.workspaceId !== row.workspace_id ||
      value.projectId !== row.job_project ||
      value.workspaceId !== row.job_workspace ||
      row.normalized !== 1
    )
      throw new JobHistoryUnavailable();
    return value;
  } catch {
    throw new JobHistoryUnavailable();
  }
}
// New rebuild callers must preserve these already indexed rows rather than
// deleting/recreating them. The SQL delete guard also stops older rebuild code
// from silently dropping a retired job's only source reference.
export const retainedRetirementSourcesSql = `SELECT r.job_id,s.value AS asset_id FROM job_history_retirements r JOIN jobs j ON j.id=r.job_id AND j.project_id=r.project_id JOIN projects p ON p.id=j.project_id AND p.workspace_id=r.workspace_id,json_each(r.manifest,'$.sourceIds') s`;
