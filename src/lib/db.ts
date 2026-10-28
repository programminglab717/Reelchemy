import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { Project, RenderJob, Timeline, CreativeBrief } from "./schema";
export const dataDir = path.join(process.cwd(), ".data");
export const artifactDir = path.join(process.cwd(), "artifacts");
mkdirSync(dataDir, { recursive: true });
mkdirSync(artifactDir, { recursive: true });
const db = new Database(path.join(dataDir, "studio.sqlite"));
db.pragma("journal_mode = WAL");
db.pragma("busy_timeout = 5000");
db.exec(
  `CREATE TABLE IF NOT EXISTS projects(id TEXT PRIMARY KEY,data TEXT NOT NULL);CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY,project_id TEXT NOT NULL,status TEXT NOT NULL,data TEXT NOT NULL,timeline TEXT NOT NULL);`,
);
export function listProjects(): Project[] {
  return (
    db
      .prepare("SELECT data FROM projects ORDER BY rowid DESC LIMIT 50")
      .all() as { data: string }[]
  ).map((r) => JSON.parse(r.data));
}
export function getProject(id: string): Project | undefined {
  const row = db.prepare("SELECT data FROM projects WHERE id=?").get(id) as
    { data: string } | undefined;
  return row ? JSON.parse(row.data) : undefined;
}
export function saveProject(p: Project) {
  db.prepare(
    "INSERT INTO projects(id,data) VALUES (?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data",
  ).run(p.id, JSON.stringify(p));
  return p;
}
export function createProject(brief: CreativeBrief) {
  return saveProject({
    id: randomUUID(),
    name: brief.prompt.slice(0, 65),
    brief,
    timeline: null,
    revisions: [],
    messages: [{ role: "user", content: brief.prompt }],
    createdAt: new Date().toISOString(),
  });
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
export function createJob(project: Project) {
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
    if (job.status === "cancelled" && patch.status !== "cancelled") return job;
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
    .all() as { id: string }[])
    updateJob(row.id, {
      status: "failed",
      error: "Worker was interrupted. Queue a new export.",
    });
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
