import {
  APIError,
  createAuthMiddleware,
  getSessionFromCtx,
} from "better-auth/api";
import { accountVerificationClaims } from "./email-verification";
import { ownerHasErasureApproval, type PrivacyVault } from "./privacy-vault";

function denied(vault: PrivacyVault | undefined, ownerId: string) {
  if (!vault) return false;
  try {
    return ownerHasErasureApproval(vault, ownerId);
  } catch {
    throw new APIError("SERVICE_UNAVAILABLE", {
      code: "ACCOUNT_PRIVACY_UNAVAILABLE",
      message: "Account privacy service is temporarily unavailable.",
    });
  }
}
export function authPrivacyHooks(
  secret: string,
  baseURL: string,
  vault?: PrivacyVault,
) {
  const before = createAuthMiddleware(async (ctx) => {
    if (vault && ctx.path === "/get-session")
      return {
        context: {
          query: {
            ...ctx.query,
            disableCookieCache: true,
            disableRefresh: true,
          },
        },
      };
    if (ctx.path === "/verify-email") {
      const claims = await accountVerificationClaims(secret, ctx.query?.token);
      const adapter = ctx.context.internalAdapter;
      const user = claims ? await adapter.findUserById(claims.accountId) : null;
      if (
        !claims ||
        !user ||
        user.email.toLowerCase() !== claims.email ||
        denied(vault, user.id)
      ) {
        if (ctx.headers?.get("accept")?.includes("text/html"))
          throw ctx.redirect(
            new URL("/sign-in?mode=verify&notice=verification", baseURL).href,
          );
        throw new APIError("BAD_REQUEST", {
          code: "VERIFICATION_LINK_INVALID",
          message: "Verification link expired or invalid. Request a new one.",
        });
      }
      // The vendor normally looks up and updates by email with awaits between
      // those steps. Pin this request's adapter to the signed ID, including the
      // final UPDATE, so deletion/address reuse during an await cannot verify B.
      // The dispatch context is per request; never mutate the shared adapter.
      ctx.context.internalAdapter = {
        ...adapter,
        findUserByEmail: async (email) => {
          if (email.toLowerCase() !== claims.email) return null;
          const current = await adapter.findUserById(claims.accountId);
          return current &&
            current.email.toLowerCase() === claims.email &&
            !denied(vault, current.id)
            ? { user: current, accounts: [] }
            : null;
        },
        updateUserByEmail: async (email, data) => {
          if (email.toLowerCase() !== claims.email || denied(vault, user.id))
            throw new APIError("BAD_REQUEST", {
              code: "VERIFICATION_LINK_INVALID",
              message:
                "Verification link expired or invalid. Request a new one.",
            });
          const updated = await adapter.updateUser(claims.accountId, data);
          if (!updated)
            throw new APIError("BAD_REQUEST", {
              code: "VERIFICATION_LINK_INVALID",
              message:
                "Verification link expired or invalid. Request a new one.",
            });
          return updated;
        },
      };
      return;
    }
    if (
      !vault ||
      [
        "/sign-in/email",
        "/sign-up/email",
        "/sign-out",
        "/send-verification-email",
        "/request-password-reset",
        "/reset-password",
        "/reset-password/:token",
      ].includes(ctx.path || "")
    )
      return;
    const session = await getSessionFromCtx(ctx, {
      disableCookieCache: true,
      disableRefresh: true,
    });
    if (session && denied(vault, session.user.id)) {
      throw new APIError("UNAUTHORIZED", {
        code: "ACCOUNT_EXPIRED",
        message: "Sign in to continue.",
      });
    }
  });
  const after = createAuthMiddleware(async (ctx) => {
    if (!vault || ctx.path !== "/get-session") return;
    const result = ctx.context.returned as
      { user?: { id?: string } } | null | undefined;
    if (result?.user?.id && denied(vault, result.user.id)) {
      ctx.context.session = null;
      ctx.context.responseHeaders?.delete("set-cookie");
      return ctx.json(null);
    }
  });
  return { before, after };
}
