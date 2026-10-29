import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { blankTimeline } from "../src/lib/editor";
process.env.REELCHEMY_DATA_DIR = await mkdtemp(
  path.join(tmpdir(), "reelchemy-project-query-"),
);
process.env.REELCHEMY_ARTIFACT_DIR = path.join(
  process.env.REELCHEMY_DATA_DIR,
  "artifacts",
);
const db = await import("../src/lib/db");

test("project listing paginates by workspace and treats search metacharacters literally", () => {
  const owner = db.ensureWorkspace("query-owner", "Owner"),
    other = db.ensureWorkspace("query-other", "Other");
  for (let i = 0; i < 55; i++)
    db.createProject(
      { prompt: `Project ${i}`, duration: 5, format: "landscape" },
      owner.id,
    );
  db.createProject(
    { prompt: "Project secret", duration: 5, format: "landscape" },
    other.id,
  );
  const literal = db.createProject(
    { prompt: "100%_done\\today", duration: 5, format: "landscape" },
    owner.id,
  );
  assert.equal(db.countProjects(owner.id), 56);
  const first = db.listProjects(owner.id, { limit: 20 }),
    second = db.listProjects(owner.id, { offset: 20, limit: 20 }),
    third = db.listProjects(owner.id, { offset: 40, limit: 20 });
  assert.equal(
    new Set([...first, ...second, ...third].map((p) => p.id)).size,
    56,
  );
  for (const query of ["%_", "\\today", "100%_done"]) {
    assert.equal(db.countProjects(owner.id, query), 1);
    assert.equal(db.listProjects(owner.id, { query })[0].id, literal.id);
  }
  assert.equal(db.countProjects(other.id), 1);
});
test("name CAS rejects stale rename and concurrent timeline revisions preserve newer metadata", () => {
  const brief = {
    prompt: "Original name",
    duration: 5,
    format: "landscape" as const,
  };
  const p = db.createProject(brief);
  db.reviseProject(p, blankTimeline(brief), "Initial");
  assert.equal(
    db.renameProject(p.id, "New name", "Original name")?.name,
    "New name",
  );
  assert.equal(db.renameProject(p.id, "Stale name", "Original name"), null);
  const timeline = structuredClone(p.timeline!);
  timeline.scenes[0].title = "New scene";
  db.reviseProject(p, timeline, "Delayed planner result");
  assert.equal(db.getProject(p.id)?.name, "New name");
  assert.equal(db.getProject(p.id)?.timeline?.scenes[0].title, "New scene");
});

test("Trash cancels active exports and hides resources without losing saved work", () => {
  const workspace = db.ensureWorkspace("trash-owner", "Trash owner");
  const brief = {
    prompt: "Keep this story",
    duration: 5,
    format: "landscape" as const,
  };
  const p = db.createProject(brief, workspace.id);
  db.reviseProject(p, blankTimeline(brief), "Initial");
  const original = JSON.stringify(db.getProject(p.id));
  const rendering = db.createJob(p);
  db.claimJob();
  const queued = db.createJob(p);
  const trashed = db.setProjectTrashed(p.id, true);
  assert(trashed.trashedAt);
  assert.equal(db.projectInWorkspace(p.id, workspace.id), false);
  assert.equal(db.projectInWorkspace(p.id, workspace.id, true), true);
  assert.equal(db.countProjects(workspace.id), 0);
  assert.equal(db.countProjects(workspace.id, "", true), 1);
  assert.equal(db.listProjects(workspace.id, { trashed: true })[0].id, p.id);
  assert.equal(db.getJob(rendering.id)?.status, "cancelled");
  assert.equal(db.getJob(queued.id)?.status, "cancelled");
  db.updateJob(rendering.id, { status: "completed" });
  assert.equal(db.getJob(rendering.id)?.status, "cancelled");
  assert.equal(db.setProjectTrashed(p.id, true).trashedAt, trashed.trashedAt);
  // A late save cannot clear the independent Trash marker.
  db.saveProject(db.getProject(p.id)!);
  assert.equal(db.projectInWorkspace(p.id, workspace.id), false);
  db.setProjectTrashed(p.id, false);
  assert.equal(db.projectInWorkspace(p.id, workspace.id), true);
  assert.equal(db.listProjects(workspace.id)[0].id, p.id);
  assert.equal(JSON.stringify(db.getProject(p.id)), original);
});
