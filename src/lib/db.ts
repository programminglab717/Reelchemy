import Database from "better-sqlite3";
import { mkdirSync, lstatSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type {
  Asset,
  Project,
  RenderJob,
  Timeline,
  CreativeBrief,
} from "./schema";
import { revisionId, RevisionConflict } from "./editor";
import { validateProjectAssets, validAssetId } from "./project-assets";
import {
  mediaStorageLimit,
  MediaStorageLimitError,
} from "./media-storage-policy";
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
// Serialize additive column migrations across web/worker startup.
db.transaction(() => {
  db.exec(
    "CREATE TABLE IF NOT EXISTS request_limits(workspace_id TEXT NOT NULL,operation TEXT NOT NULL,hits INTEGER NOT NULL,expires_at INTEGER NOT NULL,PRIMARY KEY(workspace_id,operation))",
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
  if (
    !(db.pragma("table_info(projects)") as { name: string }[]).some(
      (c) => c.name === "trashed_at",
    )
  )
    db.exec("ALTER TABLE projects ADD COLUMN trashed_at TEXT");
  db.exec(
    "CREATE INDEX IF NOT EXISTS projects_trash_idx ON projects(workspace_id,trashed_at)",
  );
  db.exec(
    "CREATE TABLE IF NOT EXISTS media_sizes(asset_id TEXT PRIMARY KEY,bytes INTEGER NOT NULL CHECK(bytes>=0)); CREATE TABLE IF NOT EXISTS schema_migrations(id TEXT PRIMARY KEY,applied_at TEXT NOT NULL)",
  );
  if (
    !db
      .prepare("SELECT id FROM schema_migrations WHERE id=?")
      .get("media-size-census-v1")
  ) {
    rebuildMediaSizeIndex();
  }
}).immediate();
function rebuildMediaSizeIndex() {
  const rows = db
    .prepare(
      "SELECT DISTINCT json_extract(a.value,'$.id') AS id FROM projects p,json_each(p.data,'$.assets') a",
    )
    .all() as { id: string }[];
  db.exec("DELETE FROM media_sizes");
  let totalBytes = 0,
    assetCount = 0;
  for (const { id } of rows) {
    if (typeof id !== "string" || !validAssetId(id)) continue;
    const bytes = measuredMediaBytes(id);
    db.prepare(
      "INSERT OR IGNORE INTO media_sizes(asset_id,bytes) VALUES (?,?)",
    ).run(id, bytes);
    totalBytes += bytes;
    assetCount++;
  }
  db.prepare(
    "INSERT INTO schema_migrations(id,applied_at) VALUES (?,?) ON CONFLICT(id) DO UPDATE SET applied_at=excluded.applied_at",
  ).run("media-size-census-v1", new Date().toISOString());
  return { assetCount, totalBytes };
}
export function recountMediaStorage() {
  return db.transaction(rebuildMediaSizeIndex).immediate();
}
function measuredMediaBytes(id: string) {
  try {
    const file = lstatSync(path.join(dataDir, "assets", id));
    return file.isFile() ? file.size : 0;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return 0;
    throw error;
  }
}
function ownedMediaSizes(workspaceId: string) {
  const query = () =>
    (
      db
        .prepare(
          "SELECT DISTINCT json_extract(a.value,'$.id') AS id,s.bytes FROM projects p,json_each(p.data,'$.assets') a LEFT JOIN media_sizes s ON s.asset_id=json_extract(a.value,'$.id') WHERE p.workspace_id=?",
        )
        .all(workspaceId) as { id: string | null; bytes: number | null }[]
    ).filter(
      (row): row is { id: string; bytes: number | null } =>
        typeof row.id === "string" && validAssetId(row.id),
    );
  const found = query();
  // Backfill newly referenced files from old snapshots/admin tools. Established
  // studios keep a read-only path, and admissions hold the same writer lock.
  if (found.some((row) => row.bytes === null))
    return db
      .transaction(() => {
        for (const row of query())
          if (row.bytes === null)
            db.prepare(
              "INSERT OR IGNORE INTO media_sizes(asset_id,bytes) VALUES (?,?)",
            ).run(row.id, measuredMediaBytes(row.id));
        return query().map((row) => ({ id: row.id, bytes: row.bytes || 0 }));
      })
      .immediate();
  return found.map((row) => ({ id: row.id, bytes: row.bytes || 0 }));
}
export function mediaStorage(workspaceId: string) {
  const owned = ownedMediaSizes(workspaceId);
  const usedBytes = owned.reduce((sum, asset) => sum + asset.bytes, 0);
  const limitBytes = mediaStorageLimit();
  return {
    usedBytes,
    limitBytes,
    remainingBytes: Math.max(0, limitBytes - usedBytes),
    assetCount: owned.length,
  };
}
function sizedMedia(assets: readonly Asset[]) {
  return assets.map((asset) => {
    if (!validAssetId(asset.id)) throw new Error("Invalid media asset.");
    const bytes = measuredMediaBytes(asset.id);
    if (bytes < 1) throw new Error("Normalized media is missing or invalid.");
    return { ...asset, bytes };
  });
}
function checkMediaStorage(
  workspaceId: string,
  assets: readonly (Asset & { bytes: number })[],
) {
  const owned = ownedMediaSizes(workspaceId),
    known = new Map(owned.map((asset) => [asset.id, asset.bytes]));
  const usedBytes = owned.reduce((sum, asset) => sum + asset.bytes, 0);
  const added = new Map(assets.map((asset) => [asset.id, asset.bytes]));
  for (const id of added.keys())
    if (
      !known.has(id) &&
      db.prepare("SELECT asset_id FROM media_sizes WHERE asset_id=?").get(id)
    )
      throw new Error("Invalid media reference.");
  const requiredBytes = Math.max(
    0,
    [...added].reduce(
      (sum, [id, bytes]) => sum + bytes - (known.get(id) || 0),
      0,
    ),
  );
  const limitBytes = mediaStorageLimit();
  if (requiredBytes > 0 && usedBytes + requiredBytes > limitBytes)
    throw new MediaStorageLimitError(usedBytes, limitBytes, requiredBytes);
  for (const [id, bytes] of added)
    db.prepare(
      "INSERT INTO media_sizes(asset_id,bytes) VALUES (?,?) ON CONFLICT(asset_id) DO UPDATE SET bytes=excluded.bytes",
    ).run(id, bytes);
}
export function appendOwnedAsset(
  projectId: string,
  workspaceId: string,
  asset: Asset,
) {
  const [normalized] = sizedMedia([asset]);
  return db
    .transaction(() => {
      if (!projectInWorkspace(projectId, workspaceId)) return undefined;
      const latest = getProject(projectId)!;
      if (latest.assets?.some((existing) => existing.id === normalized.id))
        return latest;
      if ((latest.assets || []).length >= 30)
        throw new Error("Project limit is 30 assets.");
      checkMediaStorage(workspaceId, [normalized]);
      latest.assets = [...(latest.assets || []), normalized];
      return saveProject(latest);
    })
    .immediate();
}
export function saveImportedProject(project: Project, workspaceId: string) {
  const assets = sizedMedia(project.assets || []);
  return db
    .transaction(() => {
      if (getProject(project.id))
        throw new Error("Imported project already exists.");
      checkMediaStorage(workspaceId, assets);
      return saveProject({ ...project, assets }, workspaceId);
    })
    .immediate();
}
export function takeRequestLimit(
  workspaceId: string,
  operation: string,
  count: number,
  windowMs: number,
  now = Date.now(),
) {
  return db
    .transaction(() => {
      const row = db
        .prepare(
          "SELECT hits,expires_at FROM request_limits WHERE workspace_id=? AND operation=?",
        )
        .get(workspaceId, operation) as
        { hits: number; expires_at: number } | undefined;
      if (!row || row.expires_at <= now) {
        db.prepare(
          "INSERT INTO request_limits(workspace_id,operation,hits,expires_at) VALUES (?,?,1,?) ON CONFLICT(workspace_id,operation) DO UPDATE SET hits=1,expires_at=excluded.expires_at",
        ).run(workspaceId, operation, now + windowMs);
        return { allowed: true, retryAfter: 0 };
      }
      if (row.hits >= count)
        return {
          allowed: false,
          retryAfter: Math.max(1, Math.ceil((row.expires_at - now) / 1000)),
        };
      db.prepare(
        "UPDATE request_limits SET hits=hits+1 WHERE workspace_id=? AND operation=?",
      ).run(workspaceId, operation);
      return { allowed: true, retryAfter: 0 };
    })
    .immediate();
}
export function databaseHealthy() {
  return (db.prepare("SELECT 1 AS ok").get() as { ok: number }).ok === 1;
}
export type ProjectQuery = {
  query?: string;
  offset?: number;
  limit?: number;
  trashed?: boolean;
};
function projectFilter(
  workspaceId: string | undefined,
  query = "",
  trashed = false,
) {
  const clauses: string[] = [
      trashed ? "trashed_at IS NOT NULL" : "trashed_at IS NULL",
    ],
    values: (string | number)[] = [];
  if (workspaceId) {
    clauses.push("workspace_id=?");
    values.push(workspaceId);
  }
  if (query) {
    clauses.push("json_extract(data,'$.name') LIKE ? ESCAPE '\\'");
    values.push(`%${query.replace(/[\\%_]/g, "\\$&")}%`);
  }
  return {
    where: clauses.length ? ` WHERE ${clauses.join(" AND ")}` : "",
    values,
  };
}
export function countProjects(
  workspaceId: string,
  query = "",
  trashed = false,
) {
  const filter = projectFilter(workspaceId, query, trashed);
  return (
    db
      .prepare(`SELECT COUNT(*) AS count FROM projects${filter.where}`)
      .get(...filter.values) as { count: number }
  ).count;
}
export function listProjects(
  workspaceId?: string,
  options: ProjectQuery = {},
): Project[] {
  const filter = projectFilter(workspaceId, options.query, options.trashed);
  return (
    db
      .prepare(
        `SELECT data,trashed_at FROM projects${filter.where} ORDER BY rowid DESC LIMIT ? OFFSET ?`,
      )
      .all(
        ...filter.values,
        Math.min(50, Math.max(1, options.limit || 50)),
        Math.max(0, options.offset || 0),
      ) as { data: string; trashed_at: string | null }[]
  ).map((r) => ({
    ...JSON.parse(r.data),
    ...(r.trashed_at ? { trashedAt: r.trashed_at } : {}),
  }));
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
export function renameProject(id: string, name: string, baseName: string) {
  return db
    .transaction(() => {
      const p = getProject(id);
      if (!p) throw new Error("Project not found.");
      if (p.name !== baseName) return null;
      p.name = name;
      return saveProject(p);
    })
    .immediate();
}
export function reviseProject(p: Project, timeline: Timeline, source: string) {
  return db
    .transaction(() => {
      const latest = getProject(p.id);
      if (!latest || revisionId(latest) !== revisionId(p))
        throw new RevisionConflict();
      p.timeline = timeline;
      p.name = latest.name;
      p.assets = latest.assets;
      p.revisions.push({
        id: randomUUID(),
        createdAt: new Date().toISOString(),
        timeline,
        source,
      });
      return saveProject(p);
    })
    .immediate();
}
// Recheck authorization, current media metadata and the revision under the same
// write lock. Other web/worker processes cannot trash or change the project
// between these checks and the final save.
export function reviseOwnedProject(
  p: Project,
  timeline: Timeline,
  source: string,
  workspaceId: string,
) {
  return db
    .transaction(() => {
      if (!projectInWorkspace(p.id, workspaceId)) return undefined;
      const latest = getProject(p.id)!;
      if (revisionId(latest) !== revisionId(p)) throw new RevisionConflict();
      validateProjectAssets(latest, timeline);
      return reviseProject(p, timeline, source);
    })
    .immediate();
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
  return db
    .transaction(() => {
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
    })
    .immediate();
}
export function claimJob(): { job: RenderJob; timeline: Timeline } | null {
  return db
    .transaction(() => {
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
    })
    .immediate();
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
  return db.transaction(() => enqueueJob(project)).immediate();
}
export function recordJobStage(
  id: string,
  stage: string,
  message: string = stage,
) {
  return db
    .transaction(() => {
      const job = getJob(id);
      if (!job || job.status === "cancelled") return;
      return updateJob(id, {
        status: job.status,
        stage,
        events: [
          ...(job.events || []),
          {
            at: new Date().toISOString(),
            stage,
            message: message.slice(0, 500),
          },
        ].slice(-100),
      });
    })
    .immediate();
}
export function retryJob(id: string, reason: string) {
  return db
    .transaction(() => {
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
    })
    .immediate();
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
  // Established accounts stay read-only on private GET requests. Only creation
  // needs a write lock, with a second check after admission.
  const lookup = db.prepare(
    "SELECT id,owner_id AS ownerId,name FROM workspaces WHERE owner_id=?",
  );
  const saved = lookup.get(userId) as Workspace | undefined;
  if (saved) return saved;
  return db
    .transaction(() => {
      const existing = lookup.get(userId) as Workspace | undefined;
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
    })
    .immediate();
}
export function projectInWorkspace(
  id: string,
  workspaceId: string,
  includeTrashed = false,
) {
  return !!db
    .prepare(
      `SELECT id FROM projects WHERE id=? AND workspace_id=?${includeTrashed ? "" : " AND trashed_at IS NULL"}`,
    )
    .get(id, workspaceId);
}
export function setProjectTrashed(id: string, trashed: boolean) {
  return db
    .transaction(() => {
      const row = db
        .prepare("SELECT trashed_at FROM projects WHERE id=?")
        .get(id) as { trashed_at: string | null } | undefined;
      if (!row) throw new Error("Project not found.");
      if (trashed) {
        const jobs = db
          .prepare(
            "SELECT id FROM jobs WHERE project_id=? AND status IN ('queued','rendering')",
          )
          .all(id) as { id: string }[];
        for (const job of jobs)
          updateJob(job.id, {
            status: "cancelled",
            stage: "Cancelled by moving project to Trash",
          });
      }
      const at = trashed ? row.trashed_at || new Date().toISOString() : null;
      db.prepare("UPDATE projects SET trashed_at=? WHERE id=?").run(at, id);
      return { trashedAt: at };
    })
    .immediate();
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
