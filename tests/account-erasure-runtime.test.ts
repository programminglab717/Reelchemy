import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";
import {
  initializePrivacyVault,
  recordErasureApproval,
} from "../src/lib/privacy-vault";
import { createErasureReceipt } from "../src/lib/account-erasure-approval";
import { AccountErasureUnavailable } from "../src/lib/account-erasure-policy";
import { blankTimeline } from "../src/lib/editor";
const root = mkdtempSync(
  path.join(tmpdir(), "reelchemy-studio-erasure-runtime-"),
);
Object.assign(process.env, {
  REELCHEMY_DATA_DIR: path.join(root, "data"),
  REELCHEMY_ARTIFACT_DIR: path.join(root, "artifacts"),
});
const vault = initializePrivacyVault(path.join(root, "privacy"));
const app = await import("../src/lib/db");
const db = new Database(path.join(root, "data/studio.sqlite"));
after(() => {
  db.close();
  rmSync(root, { recursive: true, force: true });
});
test("the real studio adopts erasure barriers while preserving immutable job input and another workspace", () => {
  const a = app.ensureWorkspace("runtime-erasure-A", "A"),
    b = app.ensureWorkspace("runtime-erasure-B", "B");
  const brief = {
    prompt: "Synthetic original film",
    duration: 5,
    format: "landscape" as const,
  };
  const pa = app.createProject(brief, a.id),
    pb = app.createProject(brief, b.id);
  pa.timeline = blankTimeline(brief);
  app.saveProject(pa, a.id);
  const job = app.createJob(pa);
  const originalJobInput = (
    db.prepare("SELECT timeline FROM jobs WHERE id=?").get(job.id) as {
      timeline: string;
    }
  ).timeline;
  const bBefore = db.prepare("SELECT * FROM projects WHERE id=?").get(pb.id);
  const context = {
    ownerId: a.ownerId,
    workspaceId: a.id,
    requestId: randomUUID(),
    receipt: createErasureReceipt(),
  };
  recordErasureApproval(vault, context);
  const started = app.accountErasures.begin(vault, context);
  assert.equal(started.state, "cleaning");
  assert.equal(app.projectInWorkspace(pa.id, a.id, true), false);
  assert.deepEqual(app.listProjectSummaries(a.id, { trashed: true }), []);
  assert.throws(
    () => app.ensureWorkspace(a.ownerId, "Must not reopen"),
    AccountErasureUnavailable,
  );
  assert.throws(
    () => app.saveProject({ ...pa, name: "Stale save" }, a.id),
    /Account deletion/,
  );
  assert.throws(() => app.setProjectTrashed(pa.id, false), /Account deletion/);
  assert.equal(
    (
      db.prepare("SELECT status FROM jobs WHERE id=?").get(job.id) as {
        status: string;
      }
    ).status,
    "cancelled",
  );
  assert.equal(
    (
      db.prepare("SELECT timeline FROM jobs WHERE id=?").get(job.id) as {
        timeline: string;
      }
    ).timeline,
    originalJobInput,
  );
  assert.deepEqual(
    db.prepare("SELECT * FROM projects WHERE id=?").get(pb.id),
    bBefore,
  );
  assert.equal(app.ensureWorkspace(b.ownerId, "B").id, b.id);
  assert.equal(app.projectInWorkspace(pb.id, b.id), true);
  assert.equal(app.accountErasures.pending()[0].requestId, context.requestId);
  // Existing physical-cleanup admission remains available to the private worker.
  const cleanup = app.requestOwnedProjectDeletion(pa.id, a.id);
  assert(cleanup);
  assert.equal(
    (
      db
        .prepare("SELECT state FROM project_deletions WHERE project_id=?")
        .get(pa.id) as { state: string }
    ).state,
    "queued",
  );
});
