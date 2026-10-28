import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { Project, RenderJob, Timeline, CreativeBrief } from "./schema";
// Runtime state lives on the mounted filesystem; do not embed it in server traces.
export const dataDir = path.resolve(
  /* turbopackIgnore: true */ process.env.REELCHEMY_DATA_DIR || ".data",
);
export const artifactDir = path.resolve(
  /* turbopackIgnore: true */ process.env.REELCHEMY_ARTIFACT_DIR || "artifacts",
);
mkdirSync(dataDir, { recursive: true });
mkdirSync(artifactDir, { recursive: true });
const db = new Database(path.join(dataDir, "studio.sqlite"));
db.pragma("journal_mode = WAL");
db.pragma("busy_timeout = 5000");
db.exec(
  `CREATE TABLE IF NOT EXISTS projects(id TEXT PRIMARY KEY,data TEXT NOT NULL);CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY,project_id TEXT NOT NULL,status TEXT NOT NULL,data TEXT NOT NULL,timeline TEXT NOT NULL);`,
);
// Additive migration: legacy content is retained but has no public owner until claimed offline.
db.exec(
  "CREATE TABLE IF NOT EXISTS workspaces(id TEXT PRIMARY KEY,owner_id TEXT NOT NULL UNIQUE,name TEXT NOT NULL)",
);
if (
  !(db.pragma("table_info(projects)") as { name: string }[]).some(
    (c) => c.name === "workspace_id",
  )
)
  db.exec("ALTER TABLE projects ADD COLUMN workspace_id TEXT");
db.exec(
  "CREATE INDEX IF NOT EXISTS projects_workspace_idx ON projects(workspace_id)",
);
export function listProjects(workspaceId?: string): Project[] {
  return (
    db
      .prepare(
        workspaceId
          ? "SELECT data FROM projects WHERE workspace_id=? ORDER BY rowid DESC LIMIT 50"
          : "SELECT data FROM projects ORDER BY rowid DESC LIMIT 50",
      )
      .all(...(workspaceId ? [workspaceId] : [])) as { data: string }[]
  ).map((r) => JSON.parse(r.data));
}
export function getProject(id: string): Project | undefined {
  const row = db.prepare("SELECT data FROM projects WHERE id=?").get(id) as
    { data: string } | undefined;
  return row ? JSON.parse(row.data) : undefined;
}
export function saveProject(p: Project, workspaceId?: string) {
  db.prepare(
    "INSERT INTO projects(id,data,workspace_id) VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data",
  ).run(p.id, JSON.stringify(p), workspaceId || null);
  return p;
}
export function createProject(brief: CreativeBrief, workspaceId?: string) {
  return saveProject(
    {
      id: randomUUID(),
      name: brief.prompt.slice(0, 65),
      brief,
      timeline: null,
      revisions: [],
      messages: [{ role: "user", content: brief.prompt }],
      createdAt: new Date().toISOString(),
    },
    workspaceId,
  );
}
export function reviseProject(p: Project, timeline: Timeline, source: string) {
  p.timeline = timeline;
  p.revisions.push({
    id: randomUUID(),
    createdAt: new Date().toISOString(),
    timeline,
    source,
  });
  return saveProject(p);
}
function enqueueJob(project: Project) {
  if (!project.timeline)
    throw new Error("A storyboard is required before export.");
  const active = db
    .prepare("SELECT id FROM jobs WHERE status IN ('queued','rendering')")
    .all();
  if (active.length >= 5)
    throw new Error("Render queue is full. Wait for a job to finish.");
  const job: RenderJob = {
    id: randomUUID(),
    projectId: project.id,
    status: "queued",
    progress: 0,
    error: null,
    createdAt: new Date().toISOString(),
    issues: [],
    report: null,
    attempts: 0,
    retryCount: 0,
    stage: "Queued",
    events: [
      {
        at: new Date().toISOString(),
        stage: "Queued",
        message: "Export added to queue.",
      },
    ],
  };
  db.prepare("INSERT INTO jobs VALUES (?,?,?,?,?)").run(
    job.id,
    project.id,
    job.status,
    JSON.stringify(job),
    JSON.stringify(project.timeline),
  );
  return job;
}
export function getJob(id: string): RenderJob | undefined {
  const row = db.prepare("SELECT data FROM jobs WHERE id=?").get(id) as
    { data: string } | undefined;
  return row ? JSON.parse(row.data) : undefined;
}
export function updateJob(id: string, patch: Partial<RenderJob>) {
  return db.transaction(() => {
    const job = getJob(id);
    if (!job) return;
    const updated = { ...job, ...patch };
    if (
      ["cancelled", "completed", "failed"].includes(job.status) &&
      patch.status !== job.status
    )
      return job;
    db.prepare("UPDATE jobs SET status=?,data=? WHERE id=?").run(
      updated.status,
      JSON.stringify(updated),
      id,
    );
    return updated;
  })();
}
export function claimJob(): { job: RenderJob; timeline: Timeline } | null {
  return db.transaction(() => {
    const row = db
      .prepare(
        "SELECT data,timeline FROM jobs WHERE status='queued' ORDER BY rowid LIMIT 1",
      )
      .get() as { data: string; timeline: string } | undefined;
    if (!row) return null;
    const job = JSON.parse(row.data) as RenderJob;
    updateJob(job.id, { status: "rendering" });
    return {
      job: { ...job, status: "rendering" as const },
      timeline: JSON.parse(row.timeline),
    };
  })();
}
export function recoverJobs() {
  for (const row of db
    .prepare("SELECT id FROM jobs WHERE status='rendering'")
    .all() as { id: string }[]) {
    if (
      !retryJob(row.id, "Worker interrupted; resuming from the saved timeline.")
    )
      updateJob(row.id, {
        status: "failed",
        error: "Worker interrupted after the retry limit was reached.",
      });
  }
}
export function createJob(project: Project) {
  return db.transaction(() => enqueueJob(project))();
}
export function recordJobStage(
  id: string,
  stage: string,
  message: string = stage,
) {
  return db.transaction(() => {
    const job = getJob(id);
    if (!job || job.status === "cancelled") return;
    return updateJob(id, {
      status: job.status,
      stage,
      events: [
        ...(job.events || []),
        { at: new Date().toISOString(), stage, message: message.slice(0, 500) },
      ].slice(-100),
    });
  })();
}
export function retryJob(id: string, reason: string) {
  return db.transaction(() => {
    const job = getJob(id);
    if (!job || job.status !== "rendering" || (job.retryCount || 0) >= 1)
      return false;
    updateJob(id, {
      status: "queued",
      progress: 0,
      error: null,
      retryCount: (job.retryCount || 0) + 1,
      stage: "Queued for retry",
      events: [
        ...(job.events || []),
        {
          at: new Date().toISOString(),
          stage: "Retry",
          message: reason.slice(0, 500),
        },
      ].slice(-100),
    });
    return true;
  })();
}
export function listJobs(projectId: string): RenderJob[] {
  return (
    db
      .prepare(
        "SELECT data FROM jobs WHERE project_id=? ORDER BY rowid DESC LIMIT 30",
      )
      .all(projectId) as { data: string }[]
  ).map((r) => JSON.parse(r.data));
}
export type Workspace = { id: string; ownerId: string; name: string };
export function ensureWorkspace(userId: string, name: string): Workspace {
  return db.transaction(() => {
    const existing = db
      .prepare(
        "SELECT id,owner_id AS ownerId,name FROM workspaces WHERE owner_id=?",
      )
      .get(userId) as Workspace | undefined;
    if (existing) return existing;
    const workspace = {
      id: randomUUID(),
      ownerId: userId,
      name: `${name.slice(0, 60)}'s studio`,
    };
    db.prepare("INSERT INTO workspaces(id,owner_id,name) VALUES (?,?,?)").run(
      workspace.id,
      userId,
      workspace.name,
    );
    return workspace;
  })();
}
export function projectInWorkspace(id: string, workspaceId: string) {
  return !!db
    .prepare("SELECT id FROM projects WHERE id=? AND workspace_id=?")
    .get(id, workspaceId);
}
export function claimLegacyProjects(workspaceId: string, apply = false) {
  const count = (
    db
      .prepare(
        "SELECT COUNT(*) AS count FROM projects WHERE workspace_id IS NULL",
      )
      .get() as { count: number }
  ).count;
  if (apply)
    db.prepare(
      "UPDATE projects SET workspace_id=? WHERE workspace_id IS NULL",
    ).run(workspaceId);
  return count;
}

export function workspaceForProject(id: string) {
  return (
    (
      db.prepare("SELECT workspace_id FROM projects WHERE id=?").get(id) as
        { workspace_id: string | null } | undefined
    )?.workspace_id || null
  );
}
