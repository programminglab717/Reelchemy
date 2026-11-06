import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import {
  mediaProcessingPolicy,
  MediaProcessingCapacity,
  MediaProcessingConflict,
  MediaProcessingUnavailable,
  MEDIA_DIRECT_BYTES,
} from "../src/lib/media-processing-policy";
import { LimitConfigurationError } from "../src/lib/limits-policy";
import {
  migrateMediaProcessing,
  MediaProcessingStore,
  mediaInputFingerprint,
  normalizeMediaProcessingSnapshot,
  type MediaInput,
} from "../src/lib/media-processing-store";

function fixture(file = ":memory:", env: Record<string, string> = {}) {
  const db = new Database(file);
  db.pragma("busy_timeout = 1000");
  db.exec(`CREATE TABLE IF NOT EXISTS workspaces(id TEXT PRIMARY KEY);
    CREATE TABLE IF NOT EXISTS projects(id TEXT PRIMARY KEY,workspace_id TEXT,trashed_at TEXT);
    CREATE TABLE IF NOT EXISTS project_deletions(project_id TEXT PRIMARY KEY);
    CREATE TABLE IF NOT EXISTS attached(id TEXT PRIMARY KEY);`);
  migrateMediaProcessing(db);
  let now = 1000000;
  const policy = mediaProcessingPolicy(env);
  const queue = new MediaProcessingStore(db, policy, () => now);
  const owners = Array.from({ length: 6 }, () => {
    const workspaceId = randomUUID(),
      projectId = randomUUID();
    db.prepare("INSERT INTO workspaces VALUES (?)").run(workspaceId);
    db.prepare("INSERT INTO projects VALUES (?,?,NULL)").run(
      projectId,
      workspaceId,
    );
    return { workspaceId, projectId };
  });
  const input: MediaInput = {
    operation: "upload",
    name: "Private clip.mp4",
    kind: "video",
    license: "Private test rights",
    bytes: 500,
    sha256: "a".repeat(64),
  };
  const reserve = (
    index = 0,
    operation: "upload" | "import" | "waveform" = "upload",
    requestKey = randomUUID(),
  ) =>
    queue.reserve({
      ...owners[index],
      projectId: operation === "import" ? null : owners[index].projectId,
      operation,
      requestKey,
    });
  const enqueue = (index = 0, data = input) => {
    const r = reserve(index, data.operation);
    assert.ok(r.created);
    queue.enqueue(r.receipt.id, r.token, data);
    return r;
  };
  return {
    db,
    queue,
    policy,
    owners,
    input,
    reserve,
    enqueue,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

test("media policy rejects malformed and contradictory operator limits", () => {
  const defaults = mediaProcessingPolicy({});
  assert.equal(defaults.inputs, 4);
  assert.equal(defaults.perStudioInputs, 1);
  assert.equal(defaults.rawBytes, 4 * 1024 ** 3);
  for (const value of [
    "0",
    "-1",
    "1e1",
    " 4",
    "4.5",
    "17",
    "NaN",
    "9007199254740993",
  ])
    assert.throws(
      () => mediaProcessingPolicy({ REELCHEMY_MEDIA_INPUT_SLOTS: value }),
      LimitConfigurationError,
    );
  assert.throws(
    () =>
      mediaProcessingPolicy({
        REELCHEMY_MEDIA_INPUT_SLOTS: "1",
        REELCHEMY_MEDIA_INPUTS_PER_STUDIO: "2",
      }),
    LimitConfigurationError,
  );
  assert.throws(
    () => mediaProcessingPolicy({ REELCHEMY_MEDIA_RAW_BYTES: "1048576" }),
    LimitConfigurationError,
  );
});

test("receiving requests occupy studio/global slots before any body or decode", () => {
  const f = fixture();
  try {
    f.reserve();
    assert.throws(
      () => f.reserve(),
      (error: unknown) =>
        error instanceof MediaProcessingCapacity && error.scope === "studio",
    );
    for (let i = 1; i < 4; i++) f.reserve(i);
    assert.throws(
      () => f.reserve(4),
      (error: unknown) =>
        error instanceof MediaProcessingCapacity && error.scope === "global",
    );
    // Analysis has its own bounded capacity and does not reserve raw bytes.
    for (let i = 0; i < 4; i++) f.reserve(0, "waveform");
    assert.throws(() => f.reserve(0, "waveform"), MediaProcessingCapacity);
    assert.equal(
      (
        f.db
          .prepare("SELECT sum(reserved_bytes) AS bytes FROM media_requests")
          .get() as { bytes: number }
      ).bytes,
      // Without a known size, each reserves the single-request maximum.
      4 * MEDIA_DIRECT_BYTES.upload,
    );
  } finally {
    f.db.close();
  }
});

test("a terminal receipt holds raw capacity until physical cleanup acknowledgment", () => {
  const f = fixture(":memory:", {
    REELCHEMY_MEDIA_RAW_BYTES: String(256 * 1024 * 1024),
  });
  try {
    const first = f.reserve(0, "import");
    assert.ok(first.created);
    f.queue.abandonReceiver(first.receipt.id, first.token);
    assert.equal(
      f.queue.get(first.receipt.id, f.owners[0].workspaceId)?.state,
      "failed",
    );
    assert.throws(
      () => f.reserve(1),
      (error: unknown) =>
        error instanceof MediaProcessingCapacity && error.scope === "global",
    );
    assert.equal(f.queue.cleanupCandidates()[0].id, first.receipt.id);
    f.queue.acknowledgeCleanup(first.receipt.id);
    assert.ok(f.reserve(1).created);
  } finally {
    f.db.close();
  }
});

test("request receipts are owner-scoped, intent-bound and retryable at capacity", () => {
  const f = fixture();
  try {
    const key = randomUUID(),
      intent = {
        ...f.owners[0],
        operation: "upload" as const,
        requestKey: key,
        fingerprint: mediaInputFingerprint(f.input),
      };
    const first = f.queue.reserve(intent);
    assert.ok(first.created);
    const replay = f.queue.reserve(intent);
    assert.equal(replay.created, false);
    assert.equal(replay.receipt.id, first.receipt.id);
    assert.equal("token" in replay, false);
    assert.equal(
      f.queue.get(first.receipt.id, f.owners[1].workspaceId),
      undefined,
    );
    assert.equal(
      f.queue.cancel(first.receipt.id, f.owners[1].workspaceId),
      undefined,
    );
    assert.deepEqual(f.queue.list(f.owners[1].workspaceId).requests, []);
    assert.throws(
      () => f.queue.reserve({ ...intent, fingerprint: "b".repeat(64) }),
      MediaProcessingConflict,
    );
    assert.throws(
      () =>
        f.queue.reserve({ ...intent, operation: "import", projectId: null }),
      MediaProcessingConflict,
    );
    assert.throws(
      () =>
        f.queue.enqueue(first.receipt.id, first.token, {
          ...f.input,
          license: "Different rights",
        }),
      MediaProcessingConflict,
    );
    f.queue.enqueue(first.receipt.id, first.token, f.input);
    const publicJson = JSON.stringify(f.queue.list(f.owners[0].workspaceId));
    for (const secret of [
      first.token,
      intent.fingerprint,
      f.input.license,
      f.input.name,
      f.owners[0].workspaceId,
    ])
      assert.ok(!publicJson.includes(secret));
    assert.ok(f.queue.reserve({ ...intent, ...f.owners[1] }).created);
  } finally {
    f.db.close();
  }
});

test("separate database connections observe admissions atomically and migrations preserve jobs", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "reelchemy-media-admission-"));
  const f = fixture(path.join(dir, "queue.sqlite"));
  const other = new Database(path.join(dir, "queue.sqlite"));
  try {
    const queue = new MediaProcessingStore(other, f.policy);
    const first = f.reserve();
    assert.throws(
      () =>
        queue.reserve({
          ...f.owners[0],
          operation: "upload",
          requestKey: randomUUID(),
        }),
      MediaProcessingCapacity,
    );
    migrateMediaProcessing(other);
    assert.equal(
      queue.get(first.receipt.id, f.owners[0].workspaceId)?.state,
      "receiving",
    );
    assert.throws(
      () =>
        queue.reserve({
          workspaceId: f.owners[1].workspaceId,
          projectId: f.owners[0].projectId,
          operation: "upload",
          requestKey: randomUUID(),
        }),
      MediaProcessingUnavailable,
    );
    assert.throws(
      () =>
        queue.reserve({
          workspaceId: "missing",
          projectId: null,
          operation: "import",
          requestKey: randomUUID(),
        }),
      MediaProcessingUnavailable,
    );
  } finally {
    other.close();
    f.db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("completion and attachment roll back together, preserve cancellation and reject stale attempts", () => {
  const f = fixture();
  try {
    const r = f.enqueue(),
      job = f.queue.claim()!;
    assert.equal(job.id, r.receipt.id);
    const output = randomUUID();
    f.queue.recordOutputs(job, [output]);
    assert.throws(
      () => f.queue.recordOutputs(job, []),
      MediaProcessingUnavailable,
    );
    assert.throws(
      () => f.queue.recordOutputs(job, [output, output]),
      MediaProcessingUnavailable,
    );
    assert.throws(
      () =>
        f.queue.finish(job, () => {
          f.db.prepare("INSERT INTO attached VALUES (?)").run(output);
          throw new Error("Quota changed while decoding");
        }),
      /Quota changed/,
    );
    assert.equal(f.db.prepare("SELECT * FROM attached").get(), undefined);
    assert.equal(f.queue.get(job.id, job.workspaceId)?.state, "working");
    f.queue.cancel(job.id, job.workspaceId);
    assert.equal(f.queue.isCancelled(job), true);
    let invoked = false;
    assert.throws(
      () =>
        f.queue.finish(job, () => {
          invoked = true;
          return output;
        }),
      MediaProcessingUnavailable,
    );
    assert.equal(invoked, false);
    f.queue.fail(job, "INVALID_MEDIA");
    assert.equal(f.queue.get(job.id, job.workspaceId)?.state, "cancelled");
    assert.equal(f.queue.get(job.id, job.workspaceId)?.error, null);
    assert.throws(
      () => f.queue.finish(job, () => output),
      MediaProcessingUnavailable,
    );
    assert.equal(f.queue.cleanupCandidates()[0].outputIds[0], output);
  } finally {
    f.db.close();
  }
});

test("successful attachment retains a bounded receipt and cannot be cancelled afterward", () => {
  const f = fixture();
  try {
    f.enqueue();
    const job = f.queue.claim()!,
      output = randomUUID();
    f.queue.recordOutputs(job, [output]);
    const done = f.queue.finish(job, () => {
      f.db.prepare("INSERT INTO attached VALUES (?)").run(output);
      return output;
    });
    assert.equal(done.state, "completed");
    assert.equal(done.resultId, output);
    assert.equal(f.queue.cancel(job.id, job.workspaceId)?.state, "completed");
    assert.deepEqual(f.db.prepare("SELECT * FROM attached").get(), {
      id: output,
    });
    f.advance(f.policy.receiptMs + 1);
    assert.equal(f.queue.prune(), 0);
    f.queue.acknowledgeCleanup(job.id);
    f.advance(f.policy.receiptMs + 1);
    assert.equal(f.queue.prune(), 1);
    assert.equal(f.queue.get(job.id, job.workspaceId), undefined);
  } finally {
    f.db.close();
  }
});

test("only one decoder task runs, workspace alternation and queued cancellation remain durable", () => {
  const f = fixture(":memory:", { REELCHEMY_MEDIA_INPUTS_PER_STUDIO: "3" });
  try {
    const a = f.enqueue(0);
    f.advance(1);
    const b = f.enqueue(0);
    f.advance(1);
    const c = f.enqueue(1);
    const first = f.queue.claim()!;
    assert.equal(first.id, a.receipt.id);
    assert.equal(f.queue.claim(), undefined);
    const restarted = new MediaProcessingStore(f.db, f.policy);
    assert.equal(restarted.interrupted()[0].id, first.id);
    restarted.fail(first, "INTERRUPTED");
    restarted.acknowledgeCleanup(first.id);
    const second = f.queue.claim(first.workspaceId)!;
    assert.equal(second.id, c.receipt.id);
    f.queue.fail(second, "INVALID_MEDIA");
    f.queue.acknowledgeCleanup(second.id);
    f.queue.cancel(b.receipt.id, f.owners[0].workspaceId);
    const cancelled = f.queue.claim()!;
    assert.equal(cancelled.id, b.receipt.id);
    assert.equal(cancelled.state, "cancelling");
    f.queue.fail(cancelled, "INTERRUPTED");
    assert.equal(
      f.queue.get(cancelled.id, cancelled.workspaceId)?.state,
      "cancelled",
    );
  } finally {
    f.db.close();
  }
});

test("fresh Trash and deletion checks prevent late media attachment", () => {
  const f = fixture();
  try {
    const receiver = f.reserve();
    assert.ok(receiver.created);
    f.db
      .prepare("UPDATE projects SET trashed_at='now' WHERE id=?")
      .run(f.owners[0].projectId);
    assert.throws(
      () => f.queue.enqueue(receiver.receipt.id, receiver.token, f.input),
      MediaProcessingUnavailable,
    );
    f.queue.abandonReceiver(receiver.receipt.id, receiver.token);
    f.queue.acknowledgeCleanup(receiver.receipt.id);
    f.db
      .prepare("UPDATE projects SET trashed_at=NULL WHERE id=?")
      .run(f.owners[0].projectId);
    f.enqueue();
    const job = f.queue.claim()!;
    f.db.prepare("INSERT INTO project_deletions VALUES (?)").run(job.projectId);
    assert.equal(f.queue.isCancelled(job), true);
    assert.equal(f.queue.projectBusy(job.projectId!), true);
    assert.throws(
      () => f.queue.finish(job, () => randomUUID()),
      MediaProcessingUnavailable,
    );
    f.queue.cancelProject(job.projectId!, job.workspaceId);
    f.queue.fail(job, "PROJECT_UNAVAILABLE");
    assert.equal(f.queue.projectBusy(job.projectId!), true);
    f.queue.acknowledgeCleanup(job.id);
    assert.equal(f.queue.projectBusy(job.projectId!), false);
    assert.throws(() => f.reserve(), MediaProcessingUnavailable);
  } finally {
    f.db.close();
  }
});

test("expired receivers cannot enqueue or free their raw reservation by changing state", () => {
  const f = fixture();
  try {
    const first = f.reserve();
    assert.ok(first.created);
    f.queue.cancel(first.receipt.id, f.owners[0].workspaceId);
    assert.equal(f.queue.claim(), undefined); // Writer still owns its handle.
    f.queue.acknowledgeCleanup(first.receipt.id);
    assert.equal(f.queue.projectBusy(f.owners[0].projectId), true);
    f.advance(f.policy.receiveCleanupMs);
    assert.equal(f.queue.claim(), undefined);
    assert.equal(
      f.queue.get(first.receipt.id, f.owners[0].workspaceId)?.error,
      "RECEIVE_TIMEOUT",
    );
    assert.throws(
      () => f.queue.enqueue(first.receipt.id, first.token, f.input),
      MediaProcessingUnavailable,
    );
    assert.equal(f.queue.cleanupCandidates().length, 1);
    f.queue.acknowledgeCleanup(first.receipt.id);
    assert.equal(f.queue.projectBusy(f.owners[0].projectId), false);
  } finally {
    f.db.close();
  }
});

test("backup-copy normalization cannot resurrect raw inputs and does not change its source", () => {
  const f = fixture();
  try {
    f.enqueue();
    const job = f.queue.claim()!;
    f.queue.recordOutputs(job, [randomUUID()]);
    const cancelled = f.reserve(1);
    f.queue.cancel(cancelled.receipt.id, f.owners[1].workspaceId);
    const before = f.db
      .prepare("SELECT * FROM media_requests ORDER BY id")
      .all();
    const copy = new Database(f.db.serialize());
    try {
      normalizeMediaProcessingSnapshot(copy);
      const rows = copy
        .prepare(
          "SELECT state,error,input,outputs,token,reserved_bytes FROM media_requests ORDER BY id",
        )
        .all() as {
        state: string;
        error: string | null;
        input: string | null;
        outputs: string;
        token: string | null;
        reserved_bytes: number;
      }[];
      assert.ok(
        rows.some(
          (row) => row.state === "failed" && row.error === "INTERRUPTED",
        ),
      );
      assert.ok(
        rows.some((row) => row.state === "cancelled" && row.error === null),
      );
      for (const row of rows)
        assert.deepEqual(
          {
            input: row.input,
            outputs: row.outputs,
            token: row.token,
            bytes: row.reserved_bytes,
          },
          { input: null, outputs: "[]", token: null, bytes: 0 },
        );
      assert.deepEqual(
        f.db.prepare("SELECT * FROM media_requests ORDER BY id").all(),
        before,
      );
    } finally {
      copy.close();
    }
    const legacy = new Database(":memory:");
    try {
      assert.doesNotThrow(() => normalizeMediaProcessingSnapshot(legacy));
    } finally {
      legacy.close();
    }
  } finally {
    f.db.close();
  }
});
