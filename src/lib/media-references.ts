import type Database from "better-sqlite3";
import { validAssetId } from "./project-assets";
import {
  migrateJobHistoryReferences,
  retainedRetirementSourcesSql,
} from "./job-history-references";

// These derived indexes include retained uploads and historical timelines.
// SQLite triggers keep them correct even when an older app writes the database
// during a rollback; a JS-only index update would miss those writes.
const valid =
  "typeof(asset_id)='text' AND length(asset_id)=36 AND asset_id NOT GLOB '*[^a-f0-9-]*'";
function projectRefs(document: string) {
  return `SELECT asset_id FROM (
    SELECT CASE WHEN a.type='object' THEN json_extract(a.value,'$.id') END AS asset_id FROM json_each(${document},'$.assets') a
    UNION SELECT t.value AS asset_id FROM json_tree(${document}) t WHERE t.key='assetId' AND t.type='text'
  ) WHERE ${valid}`;
}
function jobRefs(document: string) {
  return `SELECT asset_id FROM (SELECT t.value AS asset_id FROM json_tree(${document}) t WHERE t.key='assetId' AND t.type='text') WHERE ${valid}`;
}
const migration = "media-reference-index-v1";
const retiredMigration = "media-reference-index-v2";
const hasRetirements = (db: Database.Database) =>
  !!db
    .prepare(
      "SELECT 1 FROM sqlite_master WHERE type='table' AND name='job_history_retirements'",
    )
    .get();
const preservedSources = (id: string) =>
  `SELECT s.value FROM job_history_retirements r,json_each(r.manifest,'$.sourceIds') s WHERE r.job_id=${id}`;

export function rebuildMediaReferences(db: Database.Database) {
  return db
    .transaction(() => {
      const retired = hasRetirements(db);
      db.exec(
        `DELETE FROM project_media_refs; DELETE FROM job_media_refs ${retired ? `WHERE asset_id NOT IN (${preservedSources("job_media_refs.job_id")})` : ""};`,
      );
      // Keep the census inside SQLite: JS iterators hold a busy connection while
      // stepping, and materializing every complete project/history wastes memory.
      db.exec(`INSERT OR IGNORE INTO project_media_refs(project_id,asset_id)
      SELECT project_id,asset_id FROM (
        SELECT p.id AS project_id,CASE WHEN a.type='object' THEN json_extract(a.value,'$.id') END AS asset_id FROM projects p,json_each(p.data,'$.assets') a
        UNION SELECT p.id AS project_id,t.value AS asset_id FROM projects p,json_tree(p.data) t WHERE t.key='assetId' AND t.type='text'
      ) WHERE ${valid};
      INSERT OR IGNORE INTO job_media_refs(job_id,asset_id)
      SELECT job_id,asset_id FROM (
        SELECT j.id AS job_id,t.value AS asset_id FROM jobs j,json_tree(j.timeline) t WHERE t.key='assetId' AND t.type='text'
      ) WHERE ${valid};`);
      if (retired)
        db.exec(
          `INSERT OR IGNORE INTO job_media_refs(job_id,asset_id) ${retainedRetirementSourcesSql}`,
        );
      db.prepare(
        "INSERT INTO schema_migrations(id,applied_at) VALUES (?,?) ON CONFLICT(id) DO UPDATE SET applied_at=excluded.applied_at",
      ).run(retired ? retiredMigration : migration, new Date().toISOString());
      return {
        projects: (
          db
            .prepare("SELECT count(*) AS count FROM project_media_refs")
            .get() as { count: number }
        ).count,
        jobs: (
          db.prepare("SELECT count(*) AS count FROM job_media_refs").get() as {
            count: number;
          }
        ).count,
      };
    })
    .immediate();
}
export function migrateMediaReferences(db: Database.Database) {
  db.transaction(() => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations(id TEXT PRIMARY KEY,applied_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS project_media_refs(project_id TEXT NOT NULL,asset_id TEXT NOT NULL,PRIMARY KEY(project_id,asset_id));
      CREATE TABLE IF NOT EXISTS job_media_refs(job_id TEXT NOT NULL,asset_id TEXT NOT NULL,PRIMARY KEY(job_id,asset_id));
      CREATE INDEX IF NOT EXISTS project_media_asset_idx ON project_media_refs(asset_id);
      CREATE INDEX IF NOT EXISTS job_media_asset_idx ON job_media_refs(asset_id);
    `);
    // The standalone index also supports pre-account snapshots. Full current
    // application schemas add protected retired-source manifests; old snapshots
    // without that table keep their original reference-census behavior.
    const projectColumns = db.pragma("table_info(projects)") as {
        name: string;
      }[],
      jobColumns = db.pragma("table_info(jobs)") as { name: string }[];
    if (
      projectColumns.some((column) => column.name === "workspace_id") &&
      ["data", "status"].every((name) =>
        jobColumns.some((column) => column.name === name),
      )
    )
      migrateJobHistoryReferences(db);
    const retired = hasRetirements(db);
    if (retired) db.exec("DROP TRIGGER IF EXISTS job_media_refs_update");
    db.exec(`
      CREATE TRIGGER IF NOT EXISTS project_media_refs_insert AFTER INSERT ON projects BEGIN
        DELETE FROM project_media_refs WHERE project_id=NEW.id;
        INSERT OR IGNORE INTO project_media_refs(project_id,asset_id) SELECT NEW.id,asset_id FROM (${projectRefs("NEW.data")});
      END;
      CREATE TRIGGER IF NOT EXISTS project_media_refs_update AFTER UPDATE OF data ON projects BEGIN
        DELETE FROM project_media_refs WHERE project_id=NEW.id;
        INSERT OR IGNORE INTO project_media_refs(project_id,asset_id) SELECT NEW.id,asset_id FROM (${projectRefs("NEW.data")});
      END;
      CREATE TRIGGER IF NOT EXISTS project_media_refs_delete AFTER DELETE ON projects BEGIN
        DELETE FROM project_media_refs WHERE project_id=OLD.id;
      END;
      CREATE TRIGGER IF NOT EXISTS job_media_refs_insert AFTER INSERT ON jobs BEGIN
        DELETE FROM job_media_refs WHERE job_id=NEW.id;
        INSERT OR IGNORE INTO job_media_refs(job_id,asset_id) SELECT NEW.id,asset_id FROM (${jobRefs("NEW.timeline")});
      END;
      CREATE TRIGGER IF NOT EXISTS job_media_refs_update AFTER UPDATE OF timeline ON jobs BEGIN
        DELETE FROM job_media_refs WHERE job_id=NEW.id ${retired ? `AND asset_id NOT IN (${preservedSources("NEW.id")})` : ""};
        INSERT OR IGNORE INTO job_media_refs(job_id,asset_id) SELECT NEW.id,asset_id FROM (${jobRefs("NEW.timeline")});
      END;
      CREATE TRIGGER IF NOT EXISTS job_media_refs_delete AFTER DELETE ON jobs BEGIN
        DELETE FROM job_media_refs WHERE job_id=OLD.id;
      END;
    `);
    if (
      !db
        .prepare("SELECT id FROM schema_migrations WHERE id=?")
        .get(retired ? retiredMigration : migration)
    )
      rebuildMediaReferences(db);
  }).immediate();
}
export function mediaReferencedOutsideProject(
  db: Database.Database,
  assetId: string,
  projectId: string,
) {
  if (!validAssetId(assetId)) throw new Error("Invalid media reference.");
  return !!db
    .prepare(
      `
    SELECT 1 FROM project_media_refs WHERE asset_id=? AND project_id<>?
    UNION ALL SELECT 1 FROM job_media_refs r JOIN jobs j ON j.id=r.job_id WHERE r.asset_id=? AND j.project_id<>?
    LIMIT 1
  `,
    )
    .get(assetId, projectId, assetId, projectId);
}
