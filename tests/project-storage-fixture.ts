import Database from "better-sqlite3";
import {
  migrateProjectStorage,
  admitProjectData,
  type ProjectDataSize,
} from "../src/lib/project-storage";
import {
  projectStoragePolicy,
  type ProjectStoragePolicy,
} from "../src/lib/project-storage-policy";
export function storageFixture(file = ":memory:") {
  const db = new Database(file);
  db.pragma("busy_timeout=5000");
  db.exec(
    "CREATE TABLE IF NOT EXISTS projects(id TEXT PRIMARY KEY,data TEXT NOT NULL,workspace_id TEXT,trashed_at TEXT); CREATE TABLE IF NOT EXISTS project_deletions(project_id TEXT PRIMARY KEY); CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY,data TEXT,timeline TEXT)",
  );
  migrateProjectStorage(db);
  return db;
}
export function writeProject(
  db: Database.Database,
  id: string,
  owner: string | null,
  data: string,
  policy: ProjectStoragePolicy = projectStoragePolicy(),
) {
  return db
    .transaction(() => {
      const parsed = JSON.parse(data);
      const size: ProjectDataSize = {
        bytes: Buffer.byteLength(data),
        versions: parsed.revisions?.length || 0,
        messages: parsed.messages?.length || 0,
      };
      admitProjectData(db, id, owner, size, policy);
      db.prepare(
        "INSERT INTO projects VALUES(?,?,?,NULL) ON CONFLICT(id) DO UPDATE SET data=excluded.data",
      ).run(id, data, owner);
    })
    .immediate();
}
export const projectDocument = (versions = 5, messages = 8) => ({
  id: "private-project",
  name: "Preserved film",
  brief: { prompt: "Private direction", duration: 5, format: "landscape" },
  createdAt: "2026-11-02T00:00:00.000Z",
  timeline: { fps: 30, format: "landscape", scenes: [{ id: "current-film" }] },
  assets: [
    { id: "owned-source", rights: "Owned artwork", custom: "Keep provenance" },
  ],
  revisions: Array.from({ length: versions }, (_, i) => ({
    id: `version-${i}`,
    createdAt: "2026-11-02T00:00:00.000Z",
    source: `Edit ${i}`,
    timeline: { scenes: [{ id: `old-${i}` }] },
  })),
  messages: Array.from({ length: messages }, (_, i) => ({
    role: i % 2 ? "assistant" : "user",
    content: `Private direction ${i} — 保留`,
  })),
  retainedLegacyField: { source: "Do not lose this" },
});
