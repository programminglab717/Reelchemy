import type Database from "better-sqlite3";
import { z } from "zod";
import { approvedErasureContext, type PrivacyVault } from "./privacy-vault";
import { erasureApprovalSchema } from "./account-erasure-approval";
import {
  AccountErasureConflict,
  AccountErasureUnavailable,
} from "./account-erasure-policy";

export type StudioErasure = {
  workspaceId: string;
  requestId: string;
  ownerId: string;
  state: "cleaning" | "blocked" | "completed";
  requestedAt: string;
  updatedAt: string;
};
type Row = {
  workspace_id: string;
  request_id: string;
  owner_id: string;
  approval: string;
  state: StudioErasure["state"];
  requested_at: string;
  updated_at: string;
};
function fixed<T>(run: () => T): T {
  try {
    return run();
  } catch (error) {
    if (error instanceof AccountErasureConflict) throw error;
    throw new AccountErasureUnavailable();
  }
}
export function migrateAccountErasures(db: Database.Database) {
  fixed(() =>
    db
      .transaction(() => {
        for (const table of [
          "workspaces",
          "projects",
          "jobs",
          "media_requests",
          "provider_usage",
        ])
          if (
            !db
              .prepare(
                "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?",
              )
              .get(table)
          )
            throw new AccountErasureUnavailable();
        db.exec(`CREATE TABLE IF NOT EXISTS account_erasures(
      workspace_id TEXT PRIMARY KEY,request_id TEXT NOT NULL UNIQUE,owner_id TEXT NOT NULL UNIQUE,
      approval TEXT NOT NULL CHECK(length(CAST(approval AS BLOB))<=2048 AND json_valid(approval)),
      state TEXT NOT NULL CHECK(state IN ('cleaning','blocked','completed')),
      requested_at TEXT NOT NULL,updated_at TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS account_erasures_pending_idx ON account_erasures(state,workspace_id);
      CREATE TRIGGER IF NOT EXISTS erasure_barrier_context BEFORE INSERT ON account_erasures WHEN
        json_extract(NEW.approval,'$.format')<>'reelchemy-account-erasure-v1' OR
        json_extract(NEW.approval,'$.workspaceId') IS NOT NEW.workspace_id OR
        json_extract(NEW.approval,'$.requestId') IS NOT NEW.request_id OR
        json_extract(NEW.approval,'$.requestedAt') IS NOT NEW.requested_at
      BEGIN SELECT RAISE(ABORT,'Account deletion approval does not match its studio.'); END;
      CREATE TRIGGER IF NOT EXISTS erasure_barrier_immutable BEFORE UPDATE OF workspace_id,request_id,owner_id,approval,requested_at ON account_erasures BEGIN SELECT RAISE(ABORT,'Account deletion approval is immutable.'); END;
      CREATE TRIGGER IF NOT EXISTS erasure_barrier_retained BEFORE DELETE ON account_erasures BEGIN SELECT RAISE(ABORT,'Account deletion approval must be retained.'); END;
      CREATE TRIGGER IF NOT EXISTS erasing_workspace_insert BEFORE INSERT ON workspaces WHEN EXISTS(SELECT 1 FROM account_erasures e WHERE e.workspace_id=NEW.id OR e.owner_id=NEW.owner_id) BEGIN SELECT RAISE(ABORT,'Account deletion is in progress or completed.'); END;
      CREATE TRIGGER IF NOT EXISTS erasing_workspace_update BEFORE UPDATE ON workspaces WHEN EXISTS(SELECT 1 FROM account_erasures e WHERE e.workspace_id IN(OLD.id,NEW.id) OR e.owner_id IN(OLD.owner_id,NEW.owner_id)) BEGIN SELECT RAISE(ABORT,'Account deletion is in progress or completed.'); END;
      CREATE TRIGGER IF NOT EXISTS erasing_project_insert BEFORE INSERT ON projects WHEN EXISTS(SELECT 1 FROM account_erasures WHERE workspace_id=NEW.workspace_id) BEGIN SELECT RAISE(ABORT,'Account deletion is in progress or completed.'); END;
      CREATE TRIGGER IF NOT EXISTS erasing_project_update BEFORE UPDATE OF data,trashed_at,workspace_id ON projects WHEN EXISTS(SELECT 1 FROM account_erasures WHERE workspace_id IN(OLD.workspace_id,NEW.workspace_id)) BEGIN SELECT RAISE(ABORT,'Account deletion is in progress or completed.'); END;
      CREATE TRIGGER IF NOT EXISTS erasing_job_insert BEFORE INSERT ON jobs WHEN EXISTS(SELECT 1 FROM projects p JOIN account_erasures e ON e.workspace_id=p.workspace_id WHERE p.id=NEW.project_id) BEGIN SELECT RAISE(ABORT,'Account deletion is in progress or completed.'); END;
      CREATE TRIGGER IF NOT EXISTS erasing_job_move BEFORE UPDATE OF project_id ON jobs WHEN EXISTS(SELECT 1 FROM projects p JOIN account_erasures e ON e.workspace_id=p.workspace_id WHERE p.id IN(OLD.project_id,NEW.project_id)) BEGIN SELECT RAISE(ABORT,'Account deletion is in progress or completed.'); END;
      CREATE TRIGGER IF NOT EXISTS erasing_job_admit BEFORE UPDATE OF status ON jobs WHEN NEW.status IN('queued','rendering') AND EXISTS(SELECT 1 FROM projects p JOIN account_erasures e ON e.workspace_id=p.workspace_id WHERE p.id=NEW.project_id) BEGIN SELECT RAISE(ABORT,'Account deletion is in progress or completed.'); END;
      CREATE TRIGGER IF NOT EXISTS erasing_media_insert BEFORE INSERT ON media_requests WHEN EXISTS(SELECT 1 FROM account_erasures WHERE workspace_id=NEW.workspace_id) BEGIN SELECT RAISE(ABORT,'Account deletion is in progress or completed.'); END;
      CREATE TRIGGER IF NOT EXISTS erasing_media_move BEFORE UPDATE OF workspace_id ON media_requests WHEN EXISTS(SELECT 1 FROM account_erasures WHERE workspace_id IN(OLD.workspace_id,NEW.workspace_id)) BEGIN SELECT RAISE(ABORT,'Account deletion is in progress or completed.'); END;
      CREATE TRIGGER IF NOT EXISTS erasing_media_admit BEFORE UPDATE OF state ON media_requests WHEN NEW.state IN('receiving','queued','working') AND EXISTS(SELECT 1 FROM account_erasures WHERE workspace_id=NEW.workspace_id) BEGIN SELECT RAISE(ABORT,'Account deletion is in progress or completed.'); END;
      CREATE TRIGGER IF NOT EXISTS erasing_provider_admit BEFORE INSERT ON provider_usage WHEN EXISTS(SELECT 1 FROM account_erasures WHERE workspace_id=NEW.workspace_id) BEGIN SELECT RAISE(ABORT,'Account deletion is in progress or completed.'); END;`);
      })
      .immediate(),
  );
}
function publicRow(row: Row): StudioErasure {
  const approval = erasureApprovalSchema.parse(JSON.parse(row.approval));
  if (
    approval.requestId !== row.request_id ||
    approval.workspaceId !== row.workspace_id ||
    approval.requestedAt !== row.requested_at
  )
    throw new AccountErasureUnavailable();
  return {
    workspaceId: row.workspace_id,
    requestId: row.request_id,
    ownerId: row.owner_id,
    state: row.state,
    requestedAt: row.requested_at,
    updatedAt: row.updated_at,
  };
}
export function studioHasErasure(db: Database.Database, workspaceId: string) {
  return !!db
    .prepare("SELECT 1 FROM account_erasures WHERE workspace_id=?")
    .get(workspaceId);
}
export function beginStudioErasure(
  db: Database.Database,
  vault: PrivacyVault,
  input: { requestId: string; ownerId: string; workspaceId: string },
) {
  // Authenticate authority before acquiring/mutating the studio writer state.
  const approved = approvedErasureContext(
    vault,
    input.requestId,
    input.ownerId,
    input.workspaceId,
  );
  return fixed(() =>
    db
      .transaction(() => {
        const existing = db
          .prepare("SELECT * FROM account_erasures WHERE workspace_id=?")
          .get(input.workspaceId) as Row | undefined;
        if (existing) {
          if (
            existing.request_id !== input.requestId ||
            existing.owner_id !== input.ownerId ||
            existing.approval !== JSON.stringify(approved)
          )
            throw new AccountErasureConflict();
          return publicRow(existing);
        }
        const workspace = db
          .prepare("SELECT owner_id FROM workspaces WHERE id=?")
          .get(input.workspaceId) as { owner_id: string } | undefined;
        if (workspace && workspace.owner_id !== input.ownerId)
          throw new AccountErasureConflict();
        // These indexed metadata writes happen before the barrier in the same
        // IMMEDIATE transaction: no other producer can slip between either phase.
        db.prepare(
          "UPDATE projects SET trashed_at=? WHERE workspace_id=? AND trashed_at IS NULL",
        ).run(approved.requestedAt, input.workspaceId);
        db.prepare("INSERT INTO account_erasures VALUES(?,?,?,?,?,?,?)").run(
          input.workspaceId,
          input.requestId,
          input.ownerId,
          JSON.stringify(approved),
          "cleaning",
          approved.requestedAt,
          new Date().toISOString(),
        );
        db.prepare(
          `UPDATE jobs SET status='cancelled',data=json_object('id',id,'projectId',project_id,'status','cancelled','progress',0,'stage','Cancelled by account deletion','events',json('[]'),'issues',json('[]'),'report',NULL,'createdAt',?) WHERE project_id IN(SELECT id FROM projects WHERE workspace_id=?) AND status IN('queued','rendering')`,
        ).run(approved.requestedAt, input.workspaceId);
        db.prepare(
          "UPDATE media_requests SET state='cancelling',updated_at=? WHERE workspace_id=? AND state IN('receiving','queued','working')",
        ).run(Date.now(), input.workspaceId);
        // Native attempt leases, source references and provider spend holds remain
        // until their existing consumers prove teardown/settlement.
        return publicRow(
          db
            .prepare("SELECT * FROM account_erasures WHERE workspace_id=?")
            .get(input.workspaceId) as Row,
        );
      })
      .immediate(),
  );
}
export function pendingStudioErasures(db: Database.Database, limit = 10) {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 10)
    throw new AccountErasureUnavailable();
  return fixed(() =>
    (
      db
        .prepare(
          "SELECT * FROM account_erasures INDEXED BY account_erasures_pending_idx WHERE state IN('cleaning','blocked') ORDER BY workspace_id LIMIT ?",
        )
        .all(limit) as Row[]
    ).map(publicRow),
  );
}
export function blockStudioErasure(db: Database.Database, workspaceId: string) {
  z.uuid().parse(workspaceId);
  db.prepare(
    "UPDATE account_erasures SET state='blocked',updated_at=? WHERE workspace_id=? AND state='cleaning'",
  ).run(new Date().toISOString(), workspaceId);
}
