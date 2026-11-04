import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { approvedErasureContext, type PrivacyVault } from "./privacy-vault";
import {
  AccountErasureConflict,
  AccountErasureUnavailable,
} from "./account-erasure-policy";
import { PROVIDER_LEASE_MS } from "./provider-budget-policy";

// Private worker only. Removing an identity must never release the service's
// real/uncertain spending commitments or race a still-live provider request.
export function detachErasedProviderUsage(
  db: Database.Database,
  vault: PrivacyVault,
  input: { requestId: string; ownerId: string; workspaceId: string },
  now = Date.now(),
) {
  const approved = approvedErasureContext(
    vault,
    input.requestId,
    input.ownerId,
    input.workspaceId,
  );
  if (!Number.isSafeInteger(now) || now < 0)
    throw new AccountErasureUnavailable();
  try {
    return db
      .transaction(() => {
        const barrier = db
          .prepare(
            "SELECT request_id,owner_id,approval FROM account_erasures WHERE workspace_id=?",
          )
          .get(input.workspaceId) as
          | { request_id: string; owner_id: string; approval: string }
          | undefined;
        if (
          !barrier ||
          barrier.request_id !== input.requestId ||
          barrier.owner_id !== input.ownerId ||
          barrier.approval !== JSON.stringify(approved)
        )
          throw new AccountErasureConflict();
        if (
          db
            .prepare(
              "SELECT 1 FROM provider_usage WHERE workspace_id=? AND state='reserved' AND created_at>? LIMIT 1",
            )
            .get(input.workspaceId, now - PROVIDER_LEASE_MS)
        )
          return { ready: false, detached: 0 };
        // Expired reservations stay charged as uncertainty. A late real receipt
        // can still settle by immutable request ID after anonymization.
        db.prepare(
          "UPDATE provider_usage SET state='uncertain',finished_at=? WHERE workspace_id=? AND state='reserved'",
        ).run(now, input.workspaceId);
        const detached = db
          .prepare(
            "UPDATE provider_usage SET workspace_id=? WHERE workspace_id=?",
          )
          .run(`erased:${randomUUID()}`, input.workspaceId).changes;
        return { ready: true, detached };
      })
      .immediate();
  } catch (error) {
    if (error instanceof AccountErasureConflict) throw error;
    throw new AccountErasureUnavailable();
  }
}
