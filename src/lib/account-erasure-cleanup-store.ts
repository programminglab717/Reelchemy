import type Database from "better-sqlite3";
import { approvedErasureContext, type PrivacyVault } from "./privacy-vault";
import {
  AccountErasureConflict,
  AccountErasureUnavailable,
} from "./account-erasure-policy";
import { requestProjectDeletion } from "./project-deletion-store";
export type CleanupContext = {
  requestId: string;
  ownerId: string;
  workspaceId: string;
};
function check(
  db: Database.Database,
  vault: PrivacyVault,
  input: CleanupContext,
) {
  const approval = approvedErasureContext(
    vault,
    input.requestId,
    input.ownerId,
    input.workspaceId,
  );
  const row = db
    .prepare(
      "SELECT request_id,owner_id,approval FROM account_erasures WHERE workspace_id=?",
    )
    .get(input.workspaceId) as
    { request_id: string; owner_id: string; approval: string } | undefined;
  if (
    !row ||
    row.request_id !== input.requestId ||
    row.owner_id !== input.ownerId ||
    row.approval !== JSON.stringify(approval)
  )
    throw new AccountErasureConflict();
}
export function resolveErasureOwner(
  db: Database.Database,
  vault: PrivacyVault,
  requestId: string,
  workspaceId: string,
): CleanupContext {
  const row = db
    .prepare(
      "SELECT owner_id FROM account_erasures WHERE request_id=? AND workspace_id=? UNION ALL SELECT owner_id FROM workspaces WHERE id=? LIMIT 1",
    )
    .get(requestId, workspaceId, workspaceId) as
    { owner_id: string } | undefined;
  if (!row) throw new AccountErasureUnavailable();
  const context = { requestId, workspaceId, ownerId: row.owner_id };
  approvedErasureContext(vault, requestId, row.owner_id, workspaceId);
  return context;
}
// Enqueue bounded work through the existing native cleanup protocol. This does
// not unlink a file, release a lease, or retry an already failed deletion.
export function scheduleErasedProjects(
  db: Database.Database,
  vault: PrivacyVault,
  input: CleanupContext,
  limit = 5,
) {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 5)
    throw new AccountErasureUnavailable();
  return db
    .transaction(() => {
      check(db, vault, input);
      const projects = db
        .prepare(
          "SELECT p.id FROM projects p LEFT JOIN project_deletions d ON d.project_id=p.id WHERE p.workspace_id=? AND d.project_id IS NULL ORDER BY p.id LIMIT ?",
        )
        .all(input.workspaceId, limit) as { id: string }[];
      for (const project of projects)
        if (!requestProjectDeletion(db, project.id, input.workspaceId))
          throw new AccountErasureUnavailable();
      const failed = !!db
        .prepare(
          "SELECT 1 FROM project_deletions WHERE workspace_id=? AND state='failed' LIMIT 1",
        )
        .get(input.workspaceId);
      return { scheduled: projects.length, blocked: failed };
    })
    .immediate();
}
// Only metadata after existing consumers have completed their actual cleanup.
// This returns studio completion; the private worker must ALSO finish mail/auth
// and update the independent journal before reporting account completion.
export function finishErasedStudio(
  db: Database.Database,
  vault: PrivacyVault,
  input: CleanupContext,
) {
  db.pragma("secure_delete=ON");
  return db
    .transaction(() => {
      check(db, vault, input);
      const workspace = db
        .prepare("SELECT owner_id FROM workspaces WHERE id=?")
        .get(input.workspaceId) as { owner_id: string } | undefined;
      if (workspace && workspace.owner_id !== input.ownerId)
        throw new AccountErasureConflict();
      for (const sql of [
        "SELECT 1 FROM projects WHERE workspace_id=? LIMIT 1",
        "SELECT 1 FROM project_deletions WHERE workspace_id=? AND state<>'completed' LIMIT 1",
        "SELECT 1 FROM media_requests WHERE workspace_id=? AND (state IN('receiving','queued','working','cancelling') OR reserved_bytes<>0 OR outputs<>'[]') LIMIT 1",
        "SELECT 1 FROM export_storage_entries WHERE workspace_id=? LIMIT 1",
        "SELECT 1 FROM job_history_sizes WHERE workspace_id=? LIMIT 1",
        "SELECT 1 FROM job_history_retirements WHERE workspace_id=? LIMIT 1",
        "SELECT 1 FROM provider_usage WHERE workspace_id=? LIMIT 1",
      ])
        if (db.prepare(sql).get(input.workspaceId)) return { ready: false };
      db.prepare("DELETE FROM media_requests WHERE workspace_id=?").run(
        input.workspaceId,
      );
      db.prepare("DELETE FROM export_file_reviews WHERE workspace_id=?").run(
        input.workspaceId,
      );
      db.prepare("DELETE FROM request_limits WHERE workspace_id=?").run(
        input.workspaceId,
      );
      db.prepare("DELETE FROM workspaces WHERE id=? AND owner_id=?").run(
        input.workspaceId,
        input.ownerId,
      );
      db.prepare(
        "UPDATE account_erasures SET state='completed',updated_at=? WHERE workspace_id=?",
      ).run(new Date().toISOString(), input.workspaceId);
      return { ready: true };
    })
    .immediate();
}
