import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { z } from "zod";

// Director runs: generating a film takes minutes, longer than a proxy keeps a
// request open, so it runs in the background and is polled. One active run
// per studio.
// An uploaded video or image of the project whose style the director matches.
const reference = z
  .string()
  .regex(/^[a-f0-9-]{36}$/)
  .optional();
export const directorRequestSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("film"), referenceAssetId: reference }).strict(),
  z
    .object({
      kind: z.literal("film-revision"),
      instruction: z.string(),
      referenceAssetId: reference,
    })
    .strict(),
  z
    .object({
      kind: z.literal("scene-revision"),
      sceneId: z.string().max(80),
      instruction: z.string(),
      referenceAssetId: reference,
    })
    .strict(),
]);
export type DirectorRequest = z.infer<typeof directorRequestSchema>;
export type DirectorState =
  "queued" | "working" | "completed" | "failed" | "cancelled";
export type DirectorJob = {
  id: string;
  projectId: string;
  state: DirectorState;
  stage: string;
  progress: number;
  error: string | null;
  createdAt: string;
  updatedAt: string;
  request: DirectorRequest;
  // Summary of a finished run, shown to the maker.
  summary: string | null;
};
type Row = {
  id: string;
  workspace_id: string;
  project_id: string;
  state: DirectorState;
  stage: string;
  progress: number;
  error: string | null;
  created_at: number;
  updated_at: number;
  request: string;
  summary: string | null;
  plan: string | null;
};
const view = (row: Row): DirectorJob => ({
  id: row.id,
  projectId: row.project_id,
  state: row.state,
  stage: row.stage,
  progress: row.progress,
  error: row.error,
  createdAt: new Date(row.created_at).toISOString(),
  updatedAt: new Date(row.updated_at).toISOString(),
  request: directorRequestSchema.parse(JSON.parse(row.request)),
  summary: row.summary,
});
export class DirectorBusy extends Error {
  readonly status = 409;
  constructor() {
    super(
      "The director is already working on a film in your studio. Wait for it to finish or cancel it first.",
    );
  }
}
export class DirectorJobStore {
  constructor(
    private db: Database.Database,
    private now: () => number = Date.now,
  ) {
    db.exec(`CREATE TABLE IF NOT EXISTS director_jobs(
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      state TEXT NOT NULL CHECK(state IN ('queued','working','completed','failed','cancelled')),
      stage TEXT NOT NULL DEFAULT '',
      progress REAL NOT NULL DEFAULT 0,
      error TEXT,
      request TEXT NOT NULL,
      summary TEXT,
      plan TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS director_jobs_project_idx ON director_jobs(project_id, created_at);
    CREATE INDEX IF NOT EXISTS director_jobs_workspace_idx ON director_jobs(workspace_id, state);
    CREATE TRIGGER IF NOT EXISTS director_jobs_workspace_delete AFTER DELETE ON workspaces BEGIN
      DELETE FROM director_jobs WHERE workspace_id=old.id;
    END;
    CREATE TRIGGER IF NOT EXISTS director_jobs_project_delete AFTER DELETE ON projects BEGIN
      DELETE FROM director_jobs WHERE project_id=old.id;
    END;`);
  }
  create(workspaceId: string, projectId: string, request: DirectorRequest) {
    const parsed = directorRequestSchema.parse(request);
    return this.db
      .transaction(() => {
        const active = this.db
          .prepare(
            "SELECT 1 FROM director_jobs WHERE workspace_id=? AND state IN ('queued','working')",
          )
          .get(workspaceId);
        if (active) throw new DirectorBusy();
        const id = randomUUID(),
          now = this.now();
        this.db
          .prepare(
            "INSERT INTO director_jobs(id,workspace_id,project_id,state,stage,progress,request,created_at,updated_at) VALUES (?,?,?,'queued','Waiting to start',0,?,?,?)",
          )
          .run(id, workspaceId, projectId, JSON.stringify(parsed), now, now);
        return this.get(id, workspaceId)!;
      })
      .immediate();
  }
  get(id: string, workspaceId: string) {
    const row = this.db
      .prepare("SELECT * FROM director_jobs WHERE id=? AND workspace_id=?")
      .get(id, workspaceId) as Row | undefined;
    return row ? view(row) : undefined;
  }
  latest(projectId: string, workspaceId: string) {
    const row = this.db
      .prepare(
        "SELECT * FROM director_jobs WHERE project_id=? AND workspace_id=? ORDER BY created_at DESC, rowid DESC LIMIT 1",
      )
      .get(projectId, workspaceId) as Row | undefined;
    return row ? view(row) : undefined;
  }
  // The storyboard of the project's latest completed film, for revisions.
  latestPlan(projectId: string, workspaceId: string): unknown {
    const row = this.db
      .prepare(
        "SELECT plan FROM director_jobs WHERE project_id=? AND workspace_id=? AND state='completed' AND plan IS NOT NULL ORDER BY created_at DESC, rowid DESC LIMIT 1",
      )
      .get(projectId, workspaceId) as { plan: string } | undefined;
    return row ? JSON.parse(row.plan) : undefined;
  }
  progress(id: string, stage: string, progress: number) {
    this.db
      .prepare(
        "UPDATE director_jobs SET state='working',stage=?,progress=?,updated_at=? WHERE id=? AND state IN ('queued','working')",
      )
      .run(
        stage.slice(0, 200),
        Math.max(0, Math.min(1, progress)),
        this.now(),
        id,
      );
  }
  complete(id: string, summary: string, plan: unknown) {
    this.db
      .prepare(
        "UPDATE director_jobs SET state='completed',stage='Finished',progress=1,summary=?,plan=?,updated_at=? WHERE id=? AND state IN ('queued','working')",
      )
      .run(
        summary.slice(0, 2000),
        plan === undefined ? null : JSON.stringify(plan),
        this.now(),
        id,
      );
  }
  fail(id: string, error: string) {
    this.db
      .prepare(
        "UPDATE director_jobs SET state='failed',error=?,updated_at=? WHERE id=? AND state IN ('queued','working')",
      )
      .run(error.slice(0, 1000), this.now(), id);
  }
  cancel(id: string, workspaceId: string) {
    return (
      this.db
        .prepare(
          "UPDATE director_jobs SET state='cancelled',stage='Cancelled',updated_at=? WHERE id=? AND workspace_id=? AND state IN ('queued','working')",
        )
        .run(this.now(), id, workspaceId).changes > 0
    );
  }
  isActive(id: string) {
    return !!this.db
      .prepare(
        "SELECT 1 FROM director_jobs WHERE id=? AND state IN ('queued','working')",
      )
      .get(id);
  }
  // Runs live in the studio process; after a restart they cannot resume.
  interruptAll() {
    return this.db
      .prepare(
        "UPDATE director_jobs SET state='failed',error=?,updated_at=? WHERE state IN ('queued','working')",
      )
      .run(
        "The studio restarted while the director was working. Start it again.",
        this.now(),
      ).changes;
  }
}
