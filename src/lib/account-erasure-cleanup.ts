import type Database from "better-sqlite3";
import { lstatSync } from "node:fs";
import path from "node:path";
import { accountErasures } from "./db";
import { mailDir } from "./mail";
import {
  pendingAccountMailPreparations,
  accountMailCleanupPending,
} from "./mail-outbox";
import { reconcilePreparedErasureMail } from "./account-erasure-mail";
import {
  assertAuthErasureSchema,
  revokeApprovedAuthSessions,
  finishApprovedAuthErasure,
} from "./auth-erasure-store";
import {
  pendingErasureApprovals,
  erasureApprovalForRequest,
  advanceErasureState,
  type PrivacyVault,
} from "./privacy-vault";

// Private, resumable metadata coordinator. The render/media consumers retain
// exclusive responsibility for native teardown and physical source/output work.
export function processAccountErasureBatch(
  authDatabase: Database.Database,
  vault: PrivacyVault,
  afterSequence = 0,
) {
  assertAuthErasureSchema(authDatabase, vault);
  // The mail directory can exist before any message is queued (worker lock,
  // heartbeat or isolation files); only an existing outbox can hold
  // preparations. Never create one from the cleanup consumer.
  let mailboxExists = false;
  try {
    lstatSync(path.join(mailDir(), "outbox.sqlite"));
    mailboxExists = true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  let preparationErrors = 0;
  if (mailboxExists)
    for (const item of pendingAccountMailPreparations(20)) {
      try {
        reconcilePreparedErasureMail(vault, {
          accountId: item.accountId,
          workspaceId: item.workspaceId,
          requestId: item.requestId,
        });
      } catch {
        preparationErrors++;
      }
    }
  const pending = pendingErasureApprovals(vault, afterSequence, 5);
  let completed = 0,
    blocked = preparationErrors,
    scheduled = 0,
    waiting = 0;
  for (const item of pending) {
    const requestId = item.approval.requestId;
    let context: ReturnType<typeof accountErasures.resolve> | undefined;
    try {
      context = accountErasures.resolve(
        vault,
        requestId,
        item.approval.workspaceId,
      );
      accountErasures.begin(vault, context);
      revokeApprovedAuthSessions(authDatabase, vault, context);
      const mail = {
        accountId: context.ownerId,
        workspaceId: context.workspaceId,
        requestId,
      };
      reconcilePreparedErasureMail(vault, mail);
      const current = erasureApprovalForRequest(vault, requestId)!;
      if (current.status.state === "completed") continue;
      if (
        current.status.state === "requested" ||
        current.status.state === "blocked"
      )
        advanceErasureState(vault, requestId, current.status.state, "cleaning");
      const batch = accountErasures.schedule(vault, context, 5);
      scheduled += batch.scheduled;
      if (batch.blocked)
        throw new Error("Project cleanup needs operator attention.");
      const provider = accountErasures.detachProvider(vault, context);
      const mailbox = accountMailCleanupPending(mail);
      if (
        !provider.ready ||
        mailbox.pending ||
        !accountErasures.finish(vault, context).ready
      ) {
        waiting++;
        continue;
      }
      finishApprovedAuthErasure(authDatabase, vault, context);
      const state = erasureApprovalForRequest(vault, requestId)!.status.state;
      if (state === "cleaning")
        advanceErasureState(vault, requestId, "cleaning", "completed");
      completed++;
    } catch {
      blocked++;
      const current = erasureApprovalForRequest(vault, requestId);
      if (
        current &&
        (current.status.state === "requested" ||
          current.status.state === "cleaning")
      )
        advanceErasureState(vault, requestId, current.status.state, "blocked");
      if (context) accountErasures.block(context.workspaceId);
    }
  }
  return {
    completed,
    blocked,
    scheduled,
    waiting,
    nextSequence: pending.at(-1)?.approval.sequence || 0,
  };
}
