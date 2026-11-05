import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { blankTimeline } from "../src/lib/editor";
process.env.REELCHEMY_DATA_DIR = await mkdtemp(
  path.join(tmpdir(), "reelchemy-render-queue-"),
);
process.env.REELCHEMY_ARTIFACT_DIR = path.join(
  process.env.REELCHEMY_DATA_DIR,
  "artifacts",
);
process.env.REELCHEMY_RENDER_CACHE_DIR = path.join(
  process.env.REELCHEMY_DATA_DIR,
  "cache",
);
process.env.REELCHEMY_ACTIVE_EXPORTS_PER_STUDIO = "2";
const db = await import("../src/lib/db");
const inspect = new Database(
  path.join(process.env.REELCHEMY_DATA_DIR, "studio.sqlite"),
  { readonly: true },
);
function film(workspace: string, seconds: number, label: string) {
  const brief = {
    prompt: label,
    duration: 5,
    format: "landscape" as const,
  };
  return db.reviseProject(
    db.createProject(brief, workspace),
    blankTimeline({ ...brief, duration: seconds }),
    label,
  );
}
const keyRows = () =>
  (
    inspect.prepare("SELECT count(*) AS n FROM render_queue_keys").get() as {
      n: number;
    }
  ).n;

test("one studio's consecutive long films cannot hold every other studio behind them; positions are counts and studio order is kept", () => {
  const a = db.ensureWorkspace("queue-owner-a", "A").id,
    b = db.ensureWorkspace("queue-owner-b", "B").id,
    c = db.ensureWorkspace("queue-owner-c", "C").id;
  const a1 = db.createOwnedJob(film(a, 300, "A long one").id, a)!.job,
    a2 = db.createOwnedJob(film(a, 30, "A short follow-up").id, a)!.job,
    b1 = db.createOwnedJob(film(b, 300, "B long").id, b)!.job,
    c1 = db.createOwnedJob(film(c, 20, "C short").id, c)!.job;
  // Virtual finish keys: C (20 s) < A1 (300 s) <= B1 (300 s, admitted later)
  // < A2 (A1 + 30 s). A's short follow-up stays behind A's own first film.
  assert.equal(db.jobQueueAhead(c1.id), 0);
  assert.equal(db.jobQueueAhead(a1.id), 1);
  assert.equal(db.jobQueueAhead(b1.id), 2);
  assert.equal(db.jobQueueAhead(a2.id), 3);
  const order: string[] = [];
  let claimed = db.claimJob()!;
  order.push(claimed.job.id);
  // Rendering work counts as ahead of every queued export.
  assert.equal(db.jobQueueAhead(a1.id), 1);
  assert.equal(db.jobQueueAhead(a2.id), 3);
  assert.equal(db.jobQueueAhead(claimed.job.id), undefined);
  db.updateJob(claimed.job.id, { status: "completed" });
  db.finishJobAttempt(claimed.job.id);
  // A transient retry keeps the job's original place.
  claimed = db.claimJob()!;
  assert.equal(claimed.job.id, a1.id);
  assert(db.retryJob(a1.id, "Browser crashed"));
  db.finishJobAttempt(a1.id);
  assert.equal(db.jobQueueAhead(a1.id), 0);
  claimed = db.claimJob()!;
  order.push(claimed.job.id);
  db.updateJob(claimed.job.id, { status: "failed", error: "Synthetic" });
  db.finishJobAttempt(claimed.job.id);
  for (;;) {
    const next = db.claimJob();
    if (!next) break;
    order.push(next.job.id);
    db.updateJob(next.job.id, { status: "completed" });
    db.finishJobAttempt(next.job.id);
  }
  assert.deepEqual(order, [c1.id, a1.id, b1.id, a2.id]);
  assert.equal(keyRows(), 0, "Terminal jobs release their queue keys");
});

test("cancelled work leaves the order, later arrivals cannot overtake a waiting job forever and unkeyed legacy jobs keep rowid priority", async () => {
  const d = db.ensureWorkspace("queue-owner-d", "D").id,
    e = db.ensureWorkspace("queue-owner-e", "E").id;
  const long = db.createOwnedJob(film(d, 300, "D waiting").id, d)!.job;
  const cancelled = db.createOwnedJob(film(e, 5, "E cancelled").id, e)!.job;
  db.updateJob(cancelled.id, { status: "cancelled" });
  assert.equal(keyRows(), 1);
  assert.equal(db.jobQueueAhead(long.id), 0);
  // A short film admitted now ranks ahead; one admitted after the waiting
  // job's fixed key has passed cannot.
  const soon = db.createOwnedJob(film(e, 5, "E soon").id, e)!.job;
  assert.equal(db.jobQueueAhead(long.id), 1);
  assert.equal(db.jobQueueAhead(soon.id), 0);
  const write = new Database(
    path.join(process.env.REELCHEMY_DATA_DIR!, "studio.sqlite"),
  );
  try {
    const { queue_key: waiting } = write
      .prepare("SELECT queue_key FROM render_queue_keys WHERE job_id=?")
      .get(long.id) as { queue_key: number };
    // Simulate the waiting key's time passing without sleeping five minutes.
    write
      .prepare("UPDATE render_queue_keys SET queue_key=? WHERE job_id=?")
      .run(waiting - 400000, long.id);
    const later = db.createOwnedJob(film(d, 5, "D later").id, d)!.job;
    assert.equal(db.jobQueueAhead(later.id), 2);
    // A legacy queued job admitted before this release has no key.
    write.prepare("DELETE FROM render_queue_keys WHERE job_id=?").run(soon.id);
    assert.equal(db.jobQueueAhead(soon.id), 0);
    assert.equal(db.claimJob()!.job.id, soon.id);
    assert.equal(db.claimJob()!.job.id, long.id);
    assert.equal(db.claimJob()!.job.id, later.id);
    for (const id of [soon.id, long.id, later.id]) {
      db.updateJob(id, { status: "cancelled" });
      db.finishJobAttempt(id);
    }
  } finally {
    write.close();
  }
  assert.equal(keyRows(), 0);
});
