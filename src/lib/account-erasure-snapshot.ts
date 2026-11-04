import type Database from "better-sqlite3";
import {
  approvedErasureContext,
  erasureApprovalForOwner,
  privacyVaultWatermark,
  type PrivacyVault,
} from "./privacy-vault";
import {
  AccountErasureConflict,
  AccountErasureUnavailable,
} from "./account-erasure-policy";
import {
  migrateAccountErasures,
  beginStudioErasure,
} from "./account-erasure-store";
import {
  migrateAuthErasures,
  assertAuthErasureSchema,
  finishApprovedAuthErasure,
} from "./auth-erasure-store";
import { MediaProcessingStore } from "./media-processing-store";
import { ProviderUsageStore } from "./provider-usage-store";
import { detachErasedProviderUsage } from "./account-erasure-provider";
function has(db: Database.Database, table: string) {
  return !!db
    .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?")
    .get(table);
}
function context(
  vault: PrivacyVault,
  row: {
    request_id: string;
    owner_id: string;
    workspace_id: string;
    approval: string;
  },
) {
  const value = approvedErasureContext(
    vault,
    row.request_id,
    row.owner_id,
    row.workspace_id,
  );
  if (row.approval !== JSON.stringify(value))
    throw new AccountErasureConflict();
}
// ONLY the exclusive, inactive database COPIES created by backup/restore. This
// intentionally does not advance the independent journal or act on live files.
export function reconcileErasureSnapshot(
  studio: Database.Database,
  auth: Database.Database | undefined,
  vault: PrivacyVault,
) {
  privacyVaultWatermark(vault);
  if (has(studio, "account_erasures"))
    for (const row of studio
      .prepare(
        "SELECT request_id,owner_id,workspace_id,approval FROM account_erasures",
      )
      .iterate() as Iterable<{
      request_id: string;
      owner_id: string;
      workspace_id: string;
      approval: string;
    }>)
      context(vault, row);
  if (auth && has(auth, "auth_erasure_protocol"))
    assertAuthErasureSchema(auth, vault);
  if (auth && has(auth, "auth_erasure_approvals")) {
    if (!has(auth, "auth_erasure_protocol"))
      throw new AccountErasureUnavailable();
    for (const row of auth
      .prepare(
        "SELECT request_id,user_id AS owner_id,workspace_id,approval FROM auth_erasure_approvals",
      )
      .iterate() as Iterable<{
      request_id: string;
      owner_id: string;
      workspace_id: string;
      approval: string;
    }>)
      context(vault, row);
  }
  const owners = new Set<string>();
  for (const row of studio
    .prepare("SELECT owner_id FROM workspaces")
    .iterate() as Iterable<{ owner_id: string }>)
    owners.add(row.owner_id);
  if (auth)
    for (const row of auth
      .prepare("SELECT id FROM user")
      .iterate() as Iterable<{ id: string }>)
      owners.add(row.id);
  const approved = [];
  for (const ownerId of owners) {
    const record = erasureApprovalForOwner(vault, ownerId);
    if (!record) continue;
    const workspace = studio
      .prepare("SELECT id,owner_id FROM workspaces WHERE id=? OR owner_id=?")
      .all(record.approval.workspaceId, ownerId) as {
      id: string;
      owner_id: string;
    }[];
    if (
      workspace.some(
        (row) =>
          row.id !== record.approval.workspaceId || row.owner_id !== ownerId,
      )
    )
      throw new AccountErasureConflict();
    approved.push({
      ownerId,
      workspaceId: record.approval.workspaceId,
      requestId: record.approval.requestId,
    });
  }
  if (!approved.length) return { omittedAccounts: 0 };
  // Older supported copies may lack durable processing/provider tables. Creating
  // their empty metadata here is safe; no live producer or transport is attached.
  new MediaProcessingStore(studio);
  new ProviderUsageStore(studio);
  migrateAccountErasures(studio);
  if (auth) migrateAuthErasures(auth, vault);
  studio.pragma("secure_delete=ON");
  for (const item of approved) {
    studio
      .transaction(() => {
        beginStudioErasure(studio, vault, item);
        for (const table of ["export_requests", "media_deletion_targets"])
          if (has(studio, table))
            studio
              .prepare(
                `DELETE FROM ${table} WHERE project_id IN(SELECT id FROM projects WHERE workspace_id=?)`,
              )
              .run(item.workspaceId);
        studio
          .prepare(
            "DELETE FROM jobs WHERE project_id IN(SELECT id FROM projects WHERE workspace_id=?)",
          )
          .run(item.workspaceId);
        studio
          .prepare("DELETE FROM projects WHERE workspace_id=?")
          .run(item.workspaceId);
        studio
          .prepare("DELETE FROM media_requests WHERE workspace_id=?")
          .run(item.workspaceId);
        if (has(studio, "project_deletions"))
          studio
            .prepare(
              "UPDATE project_deletions SET state='completed',completed_at=?,name=NULL,manifest=NULL,error=NULL,available_at=0 WHERE workspace_id=?",
            )
            .run(new Date().toISOString(), item.workspaceId);
        // Copied requests have no live transport. Preserve every shared cost/hold,
        // but mark their old reservation uncertainty before detaching ownership.
        studio
          .prepare(
            "UPDATE provider_usage SET state='uncertain',finished_at=? WHERE workspace_id=? AND state='reserved'",
          )
          .run(Date.now(), item.workspaceId);
        if (!detachErasedProviderUsage(studio, vault, item).ready)
          throw new AccountErasureUnavailable();
        for (const table of ["request_limits", "export_file_reviews"])
          if (has(studio, table))
            studio
              .prepare(`DELETE FROM ${table} WHERE workspace_id=?`)
              .run(item.workspaceId);
        studio
          .prepare("DELETE FROM workspaces WHERE id=? AND owner_id=?")
          .run(item.workspaceId, item.ownerId);
        studio
          .prepare(
            "UPDATE account_erasures SET state='completed',updated_at=? WHERE workspace_id=?",
          )
          .run(new Date().toISOString(), item.workspaceId);
      })
      .immediate();
    if (auth) finishApprovedAuthErasure(auth, vault, item);
  }
  // The caller has not published/copied this database into service. Repack only
  // these inactive copies; original databases/WAL and independent authority stay.
  studio.exec("VACUUM");
  if (auth) auth.exec("VACUUM");
  return { omittedAccounts: approved.length };
}
