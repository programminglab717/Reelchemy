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
