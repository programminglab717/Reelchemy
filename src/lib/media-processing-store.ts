import type Database from "better-sqlite3";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import {
  MEDIA_INPUT_BYTES,
  mediaProcessingPolicy,
  MediaProcessingCapacity,
  MediaProcessingConflict,
  MediaProcessingUnavailable,
  type MediaOperation,
  type MediaProcessingPolicy,
} from "./media-processing-policy";

const uuid = z.uuid();
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const inputSchema = z.discriminatedUnion("operation", [
  z
    .object({
      operation: z.literal("upload"),
      name: z.string().min(1).max(100),
      kind: z.enum(["image", "audio", "video"]),
      license: z.string().trim().min(3).max(500),
      bytes: z.number().int().min(1).max(MEDIA_INPUT_BYTES.upload),
      sha256: hash,
    })
    .strict(),
  z
    .object({
      operation: z.literal("import"),
      bytes: z.number().int().min(1).max(MEDIA_INPUT_BYTES.import),
      sha256: hash,
    })
    .strict(),
  z.object({ operation: z.literal("waveform"), assetId: uuid }).strict(),
]);
export type MediaInput = z.infer<typeof inputSchema>;
export function mediaInputFingerprint(metadata: MediaInput) {
  return createHash("sha256")
    .update(JSON.stringify(inputSchema.parse(metadata)))
    .digest("hex");
}
export type MediaState =
  | "receiving"
  | "queued"
  | "working"
  | "cancelling"
  | "completed"
  | "failed"
  | "cancelled";
export type MediaFailure =
  | "INVALID_MEDIA"
  | "PROJECT_UNAVAILABLE"
  | "STORAGE_LIMIT"
  | "INTERRUPTED"
  | "RECEIVE_TIMEOUT"
  | "PROCESSING_TIMEOUT"
  | "PROCESSING_FAILED";
const failures: readonly MediaFailure[] = [
  "INVALID_MEDIA",
  "PROJECT_UNAVAILABLE",
  "STORAGE_LIMIT",
  "INTERRUPTED",
  "RECEIVE_TIMEOUT",
  "PROCESSING_TIMEOUT",
  "PROCESSING_FAILED",
];
type Row = {
  id: string;
  workspace_id: string;
  project_id: string | null;
  operation: MediaOperation;
  request_key: string;
  fingerprint: string | null;
  state: MediaState;
  reserved_bytes: number;
  input: string | null;
  outputs: string;
  result_id: string | null;
  error: MediaFailure | null;
  created_at: number;
  updated_at: number;
  receive_until: number;
  token: string | null;
  attempts: number;
};
export type MediaReceipt = {
  id: string;
  projectId: string | null;
  operation: MediaOperation;
  state: MediaState;
  resultId: string | null;
  error: MediaFailure | null;
  createdAt: string;
  updatedAt: string;
};
export type MediaTask = {
  id: string;
  workspaceId: string;
  projectId: string | null;
  operation: MediaOperation;
  state: "working" | "cancelling";
  token: string;
  input: MediaInput | null;
  outputIds: string[];
  attempts: number;
};
const active = "state IN ('receiving','queued','working','cancelling')";
const terminal = "state IN ('completed','failed','cancelled')";
function receipt(row: Row): MediaReceipt {
  return {
    id: row.id,
    projectId: row.project_id,
    operation: row.operation,
    state: row.state,
    resultId: row.result_id,
    error: row.error,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}
function task(row: Row): MediaTask {
  if (!row.token || (row.state !== "working" && row.state !== "cancelling"))
    throw new MediaProcessingUnavailable();
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    projectId: row.project_id,
    operation: row.operation,
    state: row.state,
    token: row.token,
    input: row.input ? inputSchema.parse(JSON.parse(row.input)) : null,
    outputIds: z.array(uuid).max(30).parse(JSON.parse(row.outputs)),
    attempts: row.attempts,
  };
}

// The queue shares studio.sqlite so output attachment and completion can commit
// together. It contains no credentials and exposes only owner-scoped receipts.
export function migrateMediaProcessing(db: Database.Database) {
  db.exec(`CREATE TABLE IF NOT EXISTS media_requests(
    id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, project_id TEXT,
    operation TEXT NOT NULL CHECK(operation IN ('upload','import','waveform')),
    request_key TEXT NOT NULL, fingerprint TEXT,
    state TEXT NOT NULL CHECK(state IN ('receiving','queued','working','cancelling','completed','failed','cancelled')),
    reserved_bytes INTEGER NOT NULL CHECK(reserved_bytes>=0), input TEXT,
    outputs TEXT NOT NULL DEFAULT '[]', result_id TEXT, error TEXT,
    created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, receive_until INTEGER NOT NULL,
    token TEXT, attempts INTEGER NOT NULL DEFAULT 0,
    UNIQUE(workspace_id,request_key));
    CREATE INDEX IF NOT EXISTS media_requests_queue_idx ON media_requests(state,created_at);
    CREATE INDEX IF NOT EXISTS media_requests_owner_idx ON media_requests(workspace_id,state);
    CREATE INDEX IF NOT EXISTS media_requests_project_idx ON media_requests(project_id,state);`);
}

export class MediaProcessingStore {
  constructor(
    private db: Database.Database,
    private policy: MediaProcessingPolicy = mediaProcessingPolicy(),
    private now: () => number = Date.now,
  ) {}
  private row(id: string) {
    return this.db
      .prepare("SELECT * FROM media_requests WHERE id=?")
      .get(id) as Row | undefined;
  }
  private owned(id: string, workspace: string) {
    const row = this.row(id);
    return row?.workspace_id === workspace ? row : undefined;
  }
  private targetActive(workspace: string, project: string | null) {
    if (!this.db.prepare("SELECT 1 FROM workspaces WHERE id=?").get(workspace))
      return false;
    return (
      project === null ||
      !!this.db
        .prepare(
          "SELECT 1 FROM projects p WHERE id=? AND workspace_id=? AND trashed_at IS NULL AND NOT EXISTS(SELECT 1 FROM project_deletions d WHERE d.project_id=p.id)",
        )
        .get(project, workspace)
    );
  }
  get(id: string, workspace: string) {
    const row = this.owned(id, workspace);
    return row ? receipt(row) : undefined;
  }
  list(workspace: string, offset = 0) {
    if (!Number.isSafeInteger(offset) || offset < 0)
      throw new MediaProcessingUnavailable();
    const rows = this.db
      .prepare(
        "SELECT * FROM media_requests WHERE workspace_id=? ORDER BY created_at DESC,id DESC LIMIT 21 OFFSET ?",
      )
      .all(workspace, offset) as Row[];
    return {
      requests: rows.slice(0, 20).map(receipt),
      nextOffset: rows.length > 20 ? offset + 20 : null,
    };
  }
  reserve(input: {
    workspaceId: string;
    projectId: string | null;
    operation: MediaOperation;
    requestKey: string;
    fingerprint?: string;
  }) {
    uuid.parse(input.requestKey);
    if (input.fingerprint !== undefined) hash.parse(input.fingerprint);
    if (
      !Object.hasOwn(MEDIA_INPUT_BYTES, input.operation) ||
      (input.operation !== "import" && input.projectId === null) ||
      (input.operation === "import" && input.projectId !== null)
    )
      throw new MediaProcessingUnavailable();
    return this.db
      .transaction(() => {
        // Replays precede capacity checks, but remain scoped to the verified owner.
        const existing = this.db
          .prepare(
            "SELECT * FROM media_requests WHERE workspace_id=? AND request_key=?",
          )
          .get(input.workspaceId, input.requestKey) as Row | undefined;
        if (existing) {
          if (
            existing.operation !== input.operation ||
            existing.project_id !== input.projectId ||
            existing.fingerprint !== (input.fingerprint ?? null)
          )
            throw new MediaProcessingConflict();
          return { receipt: receipt(existing), created: false as const };
        }
        if (!this.targetActive(input.workspaceId, input.projectId))
          throw new MediaProcessingUnavailable();
        const analysis = input.operation === "waveform";
        const group = analysis
          ? "operation='waveform'"
          : "operation<>'waveform'";
        const counts = this.db
          .prepare(
            `SELECT count(*) AS total,coalesce(sum(workspace_id=?),0) AS owned FROM media_requests WHERE ${active} AND ${group}`,
          )
          .get(input.workspaceId) as { total: number; owned: number };
        if (
          counts.owned >=
          (analysis
            ? this.policy.perStudioAnalyses
            : this.policy.perStudioInputs)
        )
          throw new MediaProcessingCapacity("studio", this.policy.retryAfter);
        const reserved = (
          this.db
            .prepare(
              "SELECT coalesce(sum(reserved_bytes),0) AS bytes FROM media_requests",
            )
            .get() as { bytes: number }
        ).bytes;
        const bytes = MEDIA_INPUT_BYTES[input.operation];
        if (
          counts.total >=
            (analysis ? this.policy.analyses : this.policy.inputs) ||
          reserved + bytes > this.policy.rawBytes
        )
          throw new MediaProcessingCapacity("global", this.policy.retryAfter);
        const id = randomUUID(),
          token = randomUUID(),
          now = this.now();
        this.db
          .prepare(
            "INSERT INTO media_requests(id,workspace_id,project_id,operation,request_key,fingerprint,state,reserved_bytes,created_at,updated_at,receive_until,token) VALUES (?,?,?,?,?,?,'receiving',?,?,?,?,?)",
          )
          .run(
            id,
            input.workspaceId,
            input.projectId,
            input.operation,
            input.requestKey,
            input.fingerprint ?? null,
            bytes,
            now,
            now,
            now + this.policy.receiveCleanupMs,
            token,
          );
        return {
          receipt: receipt(this.row(id)!),
          created: true as const,
          token,
        };
      })
      .immediate();
  }
  enqueue(id: string, receiverToken: string, metadata: MediaInput) {
    const input = inputSchema.parse(metadata);
    return this.db
      .transaction(() => {
        const row = this.row(id);
        if (
          !row ||
          row.state !== "receiving" ||
          row.token !== receiverToken ||
          row.receive_until <= this.now() ||
          row.operation !== input.operation ||
          !this.targetActive(row.workspace_id, row.project_id)
        )
          throw new MediaProcessingUnavailable();
        if (
          row.fingerprint !== null &&
          row.fingerprint !== mediaInputFingerprint(input)
        )
          throw new MediaProcessingConflict();
        this.db
          .prepare(
            "UPDATE media_requests SET state='queued',input=?,token=NULL,updated_at=? WHERE id=?",
          )
          .run(JSON.stringify(input), this.now(), id);
        return receipt(this.row(id)!);
      })
      .immediate();
  }
  cancel(id: string, workspace: string) {
    return this.db
      .transaction(() => {
        const row = this.owned(id, workspace);
        if (!row) return undefined;
        if (["receiving", "queued", "working"].includes(row.state))
          this.db
            .prepare(
              "UPDATE media_requests SET state='cancelling',updated_at=? WHERE id=?",
            )
            .run(this.now(), id);
        return receipt(this.row(id)!);
      })
      .immediate();
  }
  cancelProject(project: string, workspace: string) {
    return this.db
      .prepare(
        `UPDATE media_requests SET state='cancelling',updated_at=? WHERE project_id=? AND workspace_id=? AND state IN ('receiving','queued','working')`,
      )
      .run(this.now(), project, workspace).changes;
  }
  projectBusy(project: string) {
    return !!this.db
      .prepare(
        `SELECT 1 FROM media_requests WHERE project_id=? AND (${active} OR reserved_bytes>0) LIMIT 1`,
      )
      .get(project);
  }
  // Exactly one kernel-locked ingestion worker calls claim/recovery. Tokens
  // additionally prevent a late attempt from completing a newly claimed task.
  claim(previousWorkspace?: string) {
    return this.db
      .transaction(() => {
        const now = this.now();
        this.db
          .prepare(
            "UPDATE media_requests SET state='failed',error='RECEIVE_TIMEOUT',token=NULL,updated_at=? WHERE state IN ('receiving','cancelling') AND input IS NULL AND receive_until<=?",
          )
          .run(now, now);
        if (
          this.db
            .prepare(
              "SELECT 1 FROM media_requests WHERE state IN ('working','cancelling') AND token IS NOT NULL AND input IS NOT NULL LIMIT 1",
            )
            .get()
        )
          return undefined;
        const row = this.db
          .prepare(
            "SELECT * FROM media_requests WHERE state='queued' OR (state='cancelling' AND token IS NULL) ORDER BY CASE WHEN state='cancelling' THEN 0 ELSE 1 END,workspace_id=?,created_at,id LIMIT 1",
          )
          .get(previousWorkspace ?? "") as Row | undefined;
        if (!row) return undefined;
        const token = randomUUID();
        const state =
          row.state === "cancelling" ||
          !this.targetActive(row.workspace_id, row.project_id)
            ? "cancelling"
            : "working";
        this.db
          .prepare(
            "UPDATE media_requests SET state=?,token=?,attempts=attempts+1,updated_at=? WHERE id=?",
          )
          .run(state, token, now, row.id);
        return task(this.row(row.id)!);
      })
      .immediate();
  }
  interrupted() {
    return (
      this.db
        .prepare(
          "SELECT * FROM media_requests WHERE state IN ('working','cancelling') AND token IS NOT NULL AND input IS NOT NULL",
        )
        .all() as Row[]
    ).map(task);
  }
  isCancelled(job: MediaTask) {
    const row = this.row(job.id);
    return (
      !row ||
      row.token !== job.token ||
      row.state !== "working" ||
      !this.targetActive(row.workspace_id, row.project_id)
    );
  }
  recordOutputs(job: MediaTask, ids: string[]) {
    const outputs = z.array(uuid).max(30).parse(ids);
    if (new Set(outputs).size !== outputs.length)
      throw new MediaProcessingUnavailable();
    return this.db
      .transaction(() => {
        const row = this.row(job.id);
        if (!row || row.token !== job.token || row.state !== "working")
          throw new MediaProcessingUnavailable();
        const old = z.array(uuid).parse(JSON.parse(row.outputs));
        // Never lose a previously registered crash-cleanup target.
        if (old.some((id) => !outputs.includes(id)))
          throw new MediaProcessingUnavailable();
        this.db
          .prepare(
            "UPDATE media_requests SET outputs=?,updated_at=? WHERE id=?",
          )
          .run(JSON.stringify(outputs), this.now(), job.id);
      })
      .immediate();
  }
  finish(job: MediaTask, commit: () => string) {
    return this.db
      .transaction(() => {
        if (this.isCancelled(job)) throw new MediaProcessingUnavailable();
        // A synchronous callback attaches staged media under this same SQLite
        // writer lock. If attachment/quota validation fails, neither side commits.
        const result = uuid.parse(commit());
        this.db
          .prepare(
            "UPDATE media_requests SET state='completed',result_id=?,error=NULL,token=NULL,updated_at=? WHERE id=?",
          )
          .run(result, this.now(), job.id);
        return receipt(this.row(job.id)!);
      })
      .immediate();
  }
  fail(job: MediaTask, code: MediaFailure) {
    if (!failures.includes(code)) throw new MediaProcessingUnavailable();
    this.db
      .transaction(() => {
        const row = this.row(job.id);
        if (
          !row ||
          row.token !== job.token ||
          !["working", "cancelling"].includes(row.state)
        )
          throw new MediaProcessingUnavailable();
        this.db
          .prepare(
            "UPDATE media_requests SET state=?,error=?,token=NULL,updated_at=? WHERE id=?",
          )
          .run(
            row.state === "cancelling" ? "cancelled" : "failed",
            row.state === "cancelling" ? null : code,
            this.now(),
            job.id,
          );
      })
      .immediate();
  }
  abandonReceiver(id: string, token: string) {
    // The caller has closed its file handles and stopped writing first.
    this.db
      .prepare(
        "UPDATE media_requests SET state=CASE WHEN state='cancelling' THEN 'cancelled' ELSE 'failed' END,error=CASE WHEN state='cancelling' THEN NULL ELSE 'INVALID_MEDIA' END,token=NULL,updated_at=? WHERE id=? AND token=? AND state IN ('receiving','cancelling')",
      )
      .run(this.now(), id, token);
  }
  cleanupCandidates() {
    return (
      this.db
        .prepare(
          `SELECT id,outputs FROM media_requests WHERE ${terminal} AND (reserved_bytes>0 OR outputs<>'[]') ORDER BY updated_at LIMIT 20`,
        )
        .all() as { id: string; outputs: string }[]
    ).map((row) => ({
      id: row.id,
      outputIds: z.array(uuid).max(30).parse(JSON.parse(row.outputs)),
    }));
  }
  acknowledgeCleanup(id: string) {
    // Only after physical raw/output cleanup (retaining any committed/referenced
    // outputs). A terminal receipt alone must never release disk reservations.
    this.db
      .prepare(
        `UPDATE media_requests SET reserved_bytes=0,input=NULL,outputs='[]',updated_at=? WHERE id=? AND ${terminal}`,
      )
      .run(this.now(), id);
  }
  prune() {
    return this.db
      .prepare(
        `DELETE FROM media_requests WHERE ${terminal} AND reserved_bytes=0 AND outputs='[]' AND updated_at<?`,
      )
      .run(this.now() - this.policy.receiptMs).changes;
  }
}
