import type Database from "better-sqlite3";
import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  closeSync,
  constants,
  fstatSync,
  fsyncSync,
  ftruncateSync,
  linkSync,
  lstatSync,
  openSync,
  readdirSync,
  realpathSync,
  unlinkSync,
  writeSync,
} from "node:fs";
import path from "node:path";
import { z } from "zod";
import { withPrivateDirectory } from "./private-directory";
import {
  MAX_MEDIA_UPLOAD_BYTES,
  UPLOAD_CHUNK_BYTES,
  mediaKinds,
  type MediaKind,
} from "./timeline-limits";
import {
  MEDIA_INPUT_BYTES,
  MediaProcessingCapacity,
  type MediaProcessingPolicy,
} from "./media-processing-policy";
import { RequestBodyError } from "./http";

// Large files arrive in bounded pieces (each well under a proxy's per-request
// limit) into a private staging file on the data volume. A finished, verified
// upload is then moved into the ordinary media queue as one input, so receipts,
// quotas, cancellation and processing are unchanged.
export type UploadSession = {
  id: string;
  workspaceId: string;
  projectId: string | null;
  operation: "upload" | "import";
  kind: MediaKind | null;
  name: string | null;
  license: string | null;
  bytes: number;
  received: number;
  sha256: string | null;
  state: "open" | "complete";
  updatedAt: number;
};
type Row = {
  id: string;
  workspace_id: string;
  project_id: string | null;
  operation: "upload" | "import";
  kind: MediaKind | null;
  name: string | null;
  license: string | null;
  bytes: number;
  received: number;
  sha256: string | null;
  state: "open" | "complete";
  updated_at: number;
};
const view = (row: Row): UploadSession => ({
  id: row.id,
  workspaceId: row.workspace_id,
  projectId: row.project_id,
  operation: row.operation,
  kind: row.kind,
  name: row.name,
  license: row.license,
  bytes: row.bytes,
  received: row.received,
  sha256: row.sha256,
  state: row.state,
  updatedAt: row.updated_at,
});
export class UploadOffsetConflict extends RequestBodyError {
  constructor(readonly received: number) {
    super(
      "This piece does not continue the upload. Resume from the server's position.",
      409,
    );
  }
}
export class UploadSessionGone extends RequestBodyError {
  constructor() {
    super(
      "This upload is no longer available. Choose the file again to restart it.",
      404,
    );
  }
}
export const uploadSessionInput = z.discriminatedUnion("operation", [
  z
    .object({
      operation: z.literal("upload"),
      projectId: z.string().min(1).max(80),
      kind: z.enum(mediaKinds),
      name: z.string().min(1).max(100),
      license: z.string().trim().min(3).max(500),
      bytes: z.number().int().min(1),
    })
    .strict()
    .refine((input) => input.bytes <= MAX_MEDIA_UPLOAD_BYTES[input.kind], {
      message: "This file exceeds the upload limit for its type.",
    }),
  z
    .object({
      operation: z.literal("import"),
      bytes: z.number().int().min(1).max(MEDIA_INPUT_BYTES.import),
    })
    .strict(),
]);
export type UploadSessionInput = z.infer<typeof uploadSessionInput>;

export class UploadSessionStore {
  // One writer per session in this process; the database position guards
  // against any other writer.
  private writing = new Set<string>();
  constructor(
    private db: Database.Database,
    private root: string,
    private policy: () => MediaProcessingPolicy,
    private now: () => number = Date.now,
  ) {
    db.exec(`CREATE TABLE IF NOT EXISTS upload_sessions(
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      project_id TEXT,
      operation TEXT NOT NULL CHECK(operation IN ('upload','import')),
      kind TEXT,
      name TEXT,
      license TEXT,
      bytes INTEGER NOT NULL CHECK(bytes>0),
      received INTEGER NOT NULL DEFAULT 0 CHECK(received>=0 AND received<=bytes),
      sha256 TEXT,
      state TEXT NOT NULL CHECK(state IN ('open','complete')),
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS upload_sessions_workspace_idx ON upload_sessions(workspace_id);
    CREATE TRIGGER IF NOT EXISTS upload_sessions_workspace_delete AFTER DELETE ON workspaces BEGIN
      DELETE FROM upload_sessions WHERE workspace_id=old.id;
    END;`);
  }
  private staging<T>(operation: (anchor: string) => T) {
    return withPrivateDirectory(this.root, "upload-staging", operation);
  }
  private file(id: string) {
    z.uuid().parse(id);
    return `${id}.part`;
  }
  private row(id: string, workspaceId: string) {
    return this.db
      .prepare("SELECT * FROM upload_sessions WHERE id=? AND workspace_id=?")
      .get(id, workspaceId) as Row | undefined;
  }
  private expired(row: Row) {
    return this.now() - row.updated_at > this.policy().stagingIdleMs;
  }
  create(
    workspaceId: string,
    input: UploadSessionInput,
    admit?: () => void,
  ): UploadSession {
    const parsed = uploadSessionInput.parse(input);
    this.cleanup();
    const policy = this.policy();
    return this.db
      .transaction(() => {
        const counts = this.db
          .prepare(
            "SELECT coalesce(sum(bytes),0) AS bytes,coalesce(sum(workspace_id=?),0) AS owned FROM upload_sessions",
          )
          .get(workspaceId) as { bytes: number; owned: number };
        if (counts.owned >= policy.stagingPerStudio)
          throw new MediaProcessingCapacity("studio", policy.retryAfter);
        if (counts.bytes + parsed.bytes > policy.rawBytes)
          throw new MediaProcessingCapacity("global", policy.retryAfter);
        admit?.();
        const id = randomUUID(),
          now = this.now();
        this.db
          .prepare(
            "INSERT INTO upload_sessions(id,workspace_id,project_id,operation,kind,name,license,bytes,received,sha256,state,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,0,NULL,'open',?,?)",
          )
          .run(
            id,
            workspaceId,
            parsed.operation === "upload" ? parsed.projectId : null,
            parsed.operation,
            parsed.operation === "upload" ? parsed.kind : null,
            parsed.operation === "upload" ? parsed.name : null,
            parsed.operation === "upload" ? parsed.license : null,
            parsed.bytes,
            now,
            now,
          );
        this.staging((anchor) =>
          closeSync(
            openSync(
              path.join(anchor, this.file(id)),
              constants.O_WRONLY |
                constants.O_CREAT |
                constants.O_EXCL |
                constants.O_NOFOLLOW,
              0o600,
            ),
          ),
        );
        return view(this.row(id, workspaceId)!);
      })
      .immediate();
  }
  status(id: string, workspaceId: string) {
    const row = this.row(id, workspaceId);
    if (!row) return undefined;
    if (this.expired(row)) {
      this.remove(id, workspaceId);
      return undefined;
    }
    return view(row);
  }
  async append(
    id: string,
    workspaceId: string,
    offset: number,
    chunk: Uint8Array,
    chunkSha256: string,
  ) {
    const row = this.status(id, workspaceId);
    if (!row) throw new UploadSessionGone();
    if (row.state === "complete" || offset + chunk.length <= row.received) {
      // A retried piece that already arrived.
      if (offset <= row.received) return row;
      throw new UploadOffsetConflict(row.received);
    }
    if (offset !== row.received) throw new UploadOffsetConflict(row.received);
    if (
      !chunk.length ||
      chunk.length > UPLOAD_CHUNK_BYTES ||
      offset + chunk.length > row.bytes
    )
      throw new RequestBodyError("This piece does not fit the upload.", 400);
    if (createHash("sha256").update(chunk).digest("hex") !== chunkSha256)
      throw new RequestBodyError(
        "This piece was damaged in transit. Send it again.",
        422,
      );
    if (this.writing.has(id)) throw new UploadOffsetConflict(row.received);
    this.writing.add(id);
    try {
      this.staging((anchor) => {
        const descriptor = openSync(
          path.join(anchor, this.file(id)),
          constants.O_WRONLY | constants.O_NOFOLLOW,
        );
        try {
          const stat = fstatSync(descriptor);
          if (!stat.isFile()) throw new UploadSessionGone();
          // A crash after writing but before recording the position leaves a
          // longer file; the database position is authoritative.
          if (stat.size !== offset) ftruncateSync(descriptor, offset);
          let written = 0;
          while (written < chunk.length)
            written += writeSync(
              descriptor,
              chunk,
              written,
              chunk.length - written,
              offset + written,
            );
          fsyncSync(descriptor);
        } finally {
          closeSync(descriptor);
        }
      });
      const received = offset + chunk.length;
      const changed = this.db
        .prepare(
          "UPDATE upload_sessions SET received=?,updated_at=? WHERE id=? AND workspace_id=? AND received=? AND state='open'",
        )
        .run(received, this.now(), id, workspaceId, offset).changes;
      if (!changed) throw new UploadSessionGone();
      if (received === row.bytes) {
        const sha256 = await this.hash(id);
        this.db
          .prepare(
            "UPDATE upload_sessions SET state='complete',sha256=?,updated_at=? WHERE id=? AND workspace_id=? AND received=bytes",
          )
          .run(sha256, this.now(), id, workspaceId);
      }
      return view(this.row(id, workspaceId)!);
    } finally {
      this.writing.delete(id);
    }
  }
  private async hash(id: string) {
    // Stream from the real path; the staging directory is private to the
    // service and the inode is checked to be the file this session wrote.
    const real = path.join(
      realpathSync(this.root),
      "upload-staging",
      this.file(id),
    );
    const before = lstatSync(real);
    if (!before.isFile()) throw new UploadSessionGone();
    const hash = createHash("sha256");
    for await (const piece of createReadStream(real, {
      highWaterMark: 1024 * 1024,
    }))
      hash.update(piece as Buffer);
    const after = lstatSync(real);
    if (after.ino !== before.ino || after.size !== before.size)
      throw new UploadSessionGone();
    return hash.digest("hex");
  }
  // A finished upload ready to queue; throws if unknown, unfinished or for a
  // different target.
  complete(
    id: string,
    workspaceId: string,
    operation: "upload" | "import",
    projectId: string | null,
  ) {
    const row = this.status(id, workspaceId);
    if (!row) throw new UploadSessionGone();
    if (row.operation !== operation || row.projectId !== projectId)
      throw new RequestBodyError(
        "This upload belongs to a different destination.",
        409,
      );
    if (row.state !== "complete" || !row.sha256)
      throw new UploadOffsetConflict(row.received);
    return row;
  }
  // Call inside the queue's enqueue transaction: moves the verified staging
  // file to the queued input `media-inputs/<requestId>.input` (the layout
  // MediaInputFiles reads) and forgets the session.
  adopt(id: string, workspaceId: string, requestId: string) {
    z.uuid().parse(requestId);
    const row = this.row(id, workspaceId);
    if (!row || row.state !== "complete") throw new UploadSessionGone();
    this.staging((anchor) => {
      const source = path.join(anchor, this.file(id));
      const stat = lstatSync(source);
      if (!stat.isFile() || stat.size !== row.bytes)
        throw new UploadSessionGone();
      withPrivateDirectory(this.root, "media-inputs", (inputs) => {
        // link() refuses an existing target, unlike rename().
        linkSync(source, path.join(inputs, `${requestId}.input`));
      });
      unlinkSync(source);
    });
    this.db.prepare("DELETE FROM upload_sessions WHERE id=?").run(id);
  }
  remove(id: string, workspaceId: string) {
    const row = this.row(id, workspaceId);
    if (!row) return false;
    this.db.prepare("DELETE FROM upload_sessions WHERE id=?").run(id);
    this.unlink(id);
    return true;
  }
  private unlink(id: string) {
    this.staging((anchor) => {
      try {
        unlinkSync(path.join(anchor, this.file(id)));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    });
  }
  // Drops idle sessions and staging files that no session owns.
  cleanup() {
    const cutoff = this.now() - this.policy().stagingIdleMs;
    const stale = this.db
      .prepare("SELECT id FROM upload_sessions WHERE updated_at<?")
      .all(cutoff) as { id: string }[];
    for (const { id } of stale) {
      this.db.prepare("DELETE FROM upload_sessions WHERE id=?").run(id);
      this.unlink(id);
    }
    const known = new Set(
      (
        this.db.prepare("SELECT id FROM upload_sessions").all() as {
          id: string;
        }[]
      ).map((row) => row.id),
    );
    this.staging((anchor) => {
      for (const entry of readdirSync(anchor)) {
        const match = /^([a-f0-9-]{36})\.part$/.exec(entry);
        if (!match || known.has(match[1])) continue;
        const file = path.join(anchor, entry);
        // New sessions create their file inside the inserting transaction;
        // leave young files to avoid racing another process's commit.
        if (this.now() - lstatSync(file).mtimeMs < 5 * 60000) continue;
        unlinkSync(file);
      }
    });
  }
}
