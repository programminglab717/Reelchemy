import type Database from "better-sqlite3";
import {
  projectStoragePolicy,
  ProjectStorageLimit,
  type ProjectStoragePolicy,
} from "./project-storage-policy";
export type ProjectDataSize = {
  bytes: number;
  versions: number;
  messages: number;
};
const sizes = (document: string) =>
  `length(CAST(${document} AS BLOB)),CASE WHEN json_valid(${document}) THEN COALESCE(json_array_length(${document},'$.revisions'),0) ELSE 0 END,CASE WHEN json_valid(${document}) THEN COALESCE(json_array_length(${document},'$.messages'),0) ELSE 0 END`;
export function migrateProjectStorage(db: Database.Database) {
  db.transaction(() => {
    db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations(id TEXT PRIMARY KEY,applied_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS project_data_sizes(project_id TEXT PRIMARY KEY,bytes INTEGER NOT NULL CHECK(bytes>=0),versions INTEGER NOT NULL CHECK(versions>=0),messages INTEGER NOT NULL CHECK(messages>=0));
      CREATE TABLE IF NOT EXISTS project_retention_receipts(project_id TEXT PRIMARY KEY,request_id TEXT NOT NULL,digest TEXT NOT NULL,selection TEXT NOT NULL,result TEXT NOT NULL);
      CREATE TRIGGER IF NOT EXISTS project_data_sizes_insert AFTER INSERT ON projects BEGIN DELETE FROM project_data_sizes WHERE project_id=NEW.id; INSERT INTO project_data_sizes(project_id,bytes,versions,messages) VALUES(NEW.id,${sizes("NEW.data")}); END;
      CREATE TRIGGER IF NOT EXISTS project_data_sizes_update AFTER UPDATE OF data ON projects BEGIN DELETE FROM project_data_sizes WHERE project_id=NEW.id; INSERT INTO project_data_sizes(project_id,bytes,versions,messages) VALUES(NEW.id,${sizes("NEW.data")}); END;
      CREATE TRIGGER IF NOT EXISTS project_data_sizes_delete AFTER DELETE ON projects BEGIN DELETE FROM project_data_sizes WHERE project_id=OLD.id; DELETE FROM project_retention_receipts WHERE project_id=OLD.id; END;`);
    if (
      !db
        .prepare("SELECT 1 FROM schema_migrations WHERE id=?")
        .get("project-data-sizes-v1")
    ) {
      db.exec(
        `INSERT OR REPLACE INTO project_data_sizes(project_id,bytes,versions,messages) SELECT id,${sizes("data")} FROM projects`,
      );
      db.prepare("INSERT INTO schema_migrations VALUES(?,?)").run(
        "project-data-sizes-v1",
        new Date().toISOString(),
      );
    }
  }).immediate();
}
export function projectDataUsage(db: Database.Database, workspaceId: string) {
  return db
    .prepare(
      "SELECT COALESCE(sum(s.bytes),0) AS bytes,count(*) AS projects FROM project_data_sizes s JOIN projects p ON p.id=s.project_id WHERE p.workspace_id=?",
    )
    .get(workspaceId) as { bytes: number; projects: number };
}
// Call under the same immediate transaction as the write. Existing overages
// remain readable and reductions remain possible; no history is auto-pruned.
export function admitProjectData(
  db: Database.Database,
  projectId: string,
  workspaceId: string | null,
  next: ProjectDataSize,
  policy: ProjectStoragePolicy = projectStoragePolicy(),
) {
  const previous = db
    .prepare(
      "SELECT bytes,versions,messages FROM project_data_sizes WHERE project_id=?",
    )
    .get(projectId) as ProjectDataSize | undefined;
  for (const key of ["versions", "messages"] as const)
    if (next[key] > (previous?.[key] || 0) && next[key] > policy[key])
      throw new ProjectStorageLimit("project", key);
  const growth = next.bytes - (previous?.bytes || 0);
  if (growth > 0 && next.bytes > policy.projectBytes)
    throw new ProjectStorageLimit("project", "bytes");
  if (workspaceId && (growth > 0 || !previous)) {
    const usage = projectDataUsage(db, workspaceId);
    if (!previous && usage.projects >= policy.studioProjects)
      throw new ProjectStorageLimit("studio", "projects");
    if (growth > 0 && usage.bytes + growth > policy.studioBytes)
      throw new ProjectStorageLimit("studio", "bytes");
  }
  if (growth > 0 || !previous) {
    const all = db
      .prepare(
        "SELECT COALESCE(sum(bytes),0) AS bytes,count(*) AS projects FROM project_data_sizes",
      )
      .get() as { bytes: number; projects: number };
    if (!previous && all.projects >= policy.serviceProjects)
      throw new ProjectStorageLimit("service", "projects");
    if (growth > 0 && all.bytes + growth > policy.serviceBytes)
      throw new ProjectStorageLimit("service", "bytes");
  }
}
