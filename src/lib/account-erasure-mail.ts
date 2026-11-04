import {
  prepareAccountMail,
  commitPreparedAccountMail,
  resolvePreparedAccountMail,
  type PreparedAccountMail,
} from "./mail-outbox";
import {
  recordErasureApproval,
  erasureApprovalForRequest,
  approvedErasureContext,
  ownerHasErasureApproval,
  advanceErasureState,
  type PrivacyVault,
} from "./privacy-vault";
import {
  AccountErasureCapacity,
  AccountErasureConflict,
  AccountErasureUnavailable,
} from "./account-erasure-policy";

function authority(vault: PrivacyVault, context: PreparedAccountMail) {
  const record = erasureApprovalForRequest(vault, context.requestId);
  if (record) {
    approvedErasureContext(
      vault,
      context.requestId,
      context.accountId,
      context.workspaceId,
    );
    return "approved" as const;
  }
  // A different immutable intent for this identity must not be mistaken for
  // absence and used to release its pending private mail.
  if (ownerHasErasureApproval(vault, context.accountId))
    throw new AccountErasureUnavailable();
  return "absent" as const;
}
export function reconcilePreparedErasureMail(
  vault: PrivacyVault,
  context: PreparedAccountMail,
  options: { now?: number; withdrawImmediately?: boolean } = {},
) {
  return resolvePreparedAccountMail(
    context,
    () => authority(vault, context),
    options,
  );
}
// Called only after fresh password, verified session and rendered-actor checks.
// The email is taken from that authenticated user, never from a request field.
// No SQLite transaction spans an await or an external transport.
export function approveErasureWithMail(
  vault: PrivacyVault,
  context: PreparedAccountMail,
  email: string,
  receipt: string,
) {
  let sourceFailure: unknown;
  try {
    prepareAccountMail(context, email);
    return commitPreparedAccountMail(context, () => {
      try {
        const result = recordErasureApproval(vault, {
          ownerId: context.accountId,
          workspaceId: context.workspaceId,
          requestId: context.requestId,
          receipt,
        });
        approvedErasureContext(
          vault,
          context.requestId,
          context.accountId,
          context.workspaceId,
        );
        return result;
      } catch (error) {
        sourceFailure = error;
        throw error;
      }
    });
  } catch {
    // An uncertain mail commit must not undo a privately approved deletion.
    // The same lock order rechecks the current independent authority first.
    try {
      reconcilePreparedErasureMail(vault, context, {
        withdrawImmediately: true,
      });
    } catch {
      /* An uncertain source or malformed queue stays paused for operator review. */
    }
    const record = erasureApprovalForRequest(vault, context.requestId);
    if (record) {
      approvedErasureContext(
        vault,
        context.requestId,
        context.accountId,
        context.workspaceId,
      );
      if (
        record.status.state === "requested" ||
        record.status.state === "cleaning"
      )
        advanceErasureState(
          vault,
          context.requestId,
          record.status.state,
          "blocked",
        );
      return erasureApprovalForRequest(vault, context.requestId)!;
    }
    if (
      sourceFailure instanceof AccountErasureCapacity ||
      sourceFailure instanceof AccountErasureConflict
    )
      throw sourceFailure;
    throw new AccountErasureUnavailable();
  }
}
