import { APIError } from "better-auth/api";
import { z } from "zod";
import { accountAuthContext, getAuth } from "./auth";
import { ACCOUNT_HEADER } from "./account-session";
import { accountErasures, ensureWorkspace, takeRequestLimit } from "./db";
import { approveErasureWithMail } from "./account-erasure-mail";
import { erasureStatusByReceipt, advanceErasureState } from "./privacy-vault";
import {
  ACCOUNT_ERASURE_CONFIRMATION,
  AccountErasureUnavailable,
} from "./account-erasure-policy";
import { RequestRateError } from "./limits-policy";
import { revokeApprovedAuthSessions } from "./auth-erasure-store";

const confirmation = z
  .object({
    requestId: z.uuid(),
    receipt: z
      .string()
      .regex(/^[A-Za-z0-9_-]{43}$/)
      .refine(
        (value) =>
          Buffer.from(value, "base64url").toString("base64url") === value,
      ),
    password: z.string().min(1).max(128),
    confirmation: z.literal(ACCOUNT_ERASURE_CONFIRMATION),
  })
  .strict();
export class AccountConfirmationError extends Error {
  constructor(
    readonly status: 400 | 401 | 403 | 409,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "AccountConfirmationError";
  }
}
// Private orchestration, deliberately not exposed by a public route until the
// restore/cleanup protocol is complete. The API layer must bound the JSON body.
// No SDK response headers are returned: stale A must never clear B's cookie.
export async function confirmAccountErasure(value: unknown, headers: Headers) {
  let matchingOrigin = false;
  try {
    matchingOrigin =
      new URL(headers.get("origin") || "").origin ===
      new URL(process.env.BETTER_AUTH_URL || "http://127.0.0.1:3001").origin;
  } catch {}
  if (!matchingOrigin)
    throw new AccountConfirmationError(
      403,
      "ACCOUNT_CONFIRMATION_ORIGIN",
      "Open the studio to confirm account deletion.",
    );
  const parsed = confirmation.safeParse(value);
  if (!parsed.success)
    throw new AccountConfirmationError(
      400,
      "ACCOUNT_CONFIRMATION_INVALID",
      "Enter your password and the exact account-deletion confirmation.",
    );
  const input = parsed.data;
  const { database, vault } = await accountAuthContext();
  const replay = erasureStatusByReceipt(vault, input.requestId, input.receipt);
  if (replay) return replay;
  const auth = await getAuth();
  const session = await auth.api.getSession({ headers });
  if (!session?.user.emailVerified)
    throw new AccountConfirmationError(
      401,
      "ACCOUNT_EXPIRED",
      "Sign in with a verified account to continue.",
    );
  if (headers.get(ACCOUNT_HEADER) !== session.user.id)
    throw new AccountConfirmationError(
      409,
      "ACCOUNT_CHANGED",
      "The account in this browser changed. Reload before confirming account deletion.",
    );
  const workspace = ensureWorkspace(session.user.id, session.user.name);
  const limit = takeRequestLimit(
    workspace.id,
    "account-erasure-confirmation",
    5,
    60 * 60 * 1000,
  );
  if (!limit.allowed) throw new RequestRateError(limit.retryAfter, "writes");
  try {
    const verified = await auth.api.verifyPassword({
      headers,
      body: { password: input.password },
    });
    if (!verified.status)
      throw new AccountConfirmationError(
        401,
        "ACCOUNT_PASSWORD_INVALID",
        "Your password could not be verified.",
      );
  } catch (error) {
    if (error instanceof AccountConfirmationError) throw error;
    if (error instanceof APIError && [400, 401, 403].includes(error.statusCode))
      throw new AccountConfirmationError(
        401,
        "ACCOUNT_PASSWORD_INVALID",
        "Your password could not be verified.",
      );
    throw new AccountErasureUnavailable();
  }
  // Password verification awaits native work. Recheck the same cookie's current
  // server-side session and workspace before committing irreversible intent.
  const current = await auth.api.getSession({ headers });
  if (!current?.user.emailVerified || current.user.id !== session.user.id)
    throw new AccountConfirmationError(
      401,
      "ACCOUNT_EXPIRED",
      "Your session changed. Sign in again before confirming account deletion.",
    );
  if (ensureWorkspace(current.user.id, current.user.name).id !== workspace.id)
    throw new AccountErasureUnavailable();
  const context = {
    requestId: input.requestId,
    ownerId: current.user.id,
    workspaceId: workspace.id,
  };
  approveErasureWithMail(
    vault,
    {
      requestId: context.requestId,
      workspaceId: context.workspaceId,
      accountId: current.user.id,
    },
    current.user.email,
    input.receipt,
  );
  let blocked = false;
  try {
    accountErasures.begin(vault, context);
  } catch {
    blocked = true;
  }
  try {
    revokeApprovedAuthSessions(database, vault, context);
  } catch {
    blocked = true;
  }
  const accepted = erasureStatusByReceipt(
    vault,
    input.requestId,
    input.receipt,
  );
  if (!accepted) throw new AccountErasureUnavailable();
  if (
    blocked &&
    (accepted.state === "requested" || accepted.state === "cleaning")
  )
    advanceErasureState(vault, input.requestId, accepted.state, "blocked");
  else if (!blocked && accepted.state === "requested")
    advanceErasureState(vault, input.requestId, "requested", "cleaning");
  return erasureStatusByReceipt(vault, input.requestId, input.receipt)!;
}
