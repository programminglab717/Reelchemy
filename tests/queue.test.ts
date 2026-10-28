import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { mockPlan } from "../src/lib/provider";
process.env.REELCHEMY_DATA_DIR = await mkdtemp(
  path.join(tmpdir(), "reelchemy-queue-test-"),
);
process.env.REELCHEMY_ARTIFACT_DIR = path.join(
  process.env.REELCHEMY_DATA_DIR,
  "artifacts",
);
const db = await import("../src/lib/db");
test("queue snapshots survive retries/recovery and terminal jobs cannot be resurrected", () => {
  const brief = {
    prompt: "Original plan",
    duration: 5,
    format: "landscape" as const,
  };
  const project = db.createProject(brief);
  db.reviseProject(project, mockPlan(brief), "Test");
  const job = db.createJob(project);
  project.timeline!.scenes[0].title = "Edited after enqueue";
  db.saveProject(project);
  const claimed = db.claimJob()!;
  assert.equal(claimed.job.id, job.id);
  assert.notEqual(claimed.timeline.scenes[0].title, "Edited after enqueue");
  db.recordJobStage(job.id, "Checking layout");
  assert.equal(db.getJob(job.id)?.events?.at(-1)?.stage, "Checking layout");
  assert(db.retryJob(job.id, "Browser crashed"));
  assert.equal(db.getJob(job.id)?.retryCount, 1);
  assert.deepEqual(db.claimJob()!.timeline, claimed.timeline);
  assert.equal(db.retryJob(job.id, "Browser crashed again"), false);
  db.recoverJobs();
  assert.equal(db.getJob(job.id)?.status, "failed");
  db.updateJob(job.id, { status: "completed" });
  assert.equal(db.getJob(job.id)?.status, "failed");
  const second = db.createJob(project);
  db.claimJob();
  db.recoverJobs();
  assert.equal(db.getJob(second.id)?.status, "queued");
  assert.equal(db.getJob(second.id)?.retryCount, 1);
  db.updateJob(second.id, { status: "cancelled" });
  assert.equal(db.retryJob(second.id, "Ignored"), false);
  db.updateJob(second.id, { status: "rendering" });
  assert.equal(db.getJob(second.id)?.status, "cancelled");
});
test("queue admission limit is enforced across actual persisted jobs", () => {
  const p = db.createProject({
    prompt: "Queue cap",
    duration: 5,
    format: "square",
  });
  p.timeline = mockPlan(p.brief);
  const jobs = Array.from({ length: 5 }, () => db.createJob(p));
  assert.throws(() => db.createJob(p), /queue is full/);
  for (const j of jobs) db.updateJob(j.id, { status: "cancelled" });
});
test("workspace ownership is immutable through normal saves and legacy content is unassigned", () => {
  const alice = db.ensureWorkspace("test-alice", "Alice"),
    bob = db.ensureWorkspace("test-bob", "Bob");
  const p = db.createProject(
    { prompt: "Private project", duration: 5, format: "landscape" },
    alice.id,
  );
  assert(db.projectInWorkspace(p.id, alice.id));
  assert(!db.projectInWorkspace(p.id, bob.id));
  assert(db.listProjects(alice.id).some((x) => x.id === p.id));
  assert(!db.listProjects(bob.id).some((x) => x.id === p.id));
  p.name = "Updated";
  db.saveProject(p, bob.id);
  assert(db.projectInWorkspace(p.id, alice.id));
  assert(!db.projectInWorkspace(p.id, bob.id));
  const legacy = db.createProject(p.brief);
  assert(!db.projectInWorkspace(legacy.id, alice.id));
  assert(db.claimLegacyProjects(alice.id) > 0);
});
