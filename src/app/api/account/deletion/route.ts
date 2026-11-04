import { z } from "zod";
import { readLimitedBody, RequestBodyError } from "@/lib/http";
import {
  confirmAccountErasure,
  AccountConfirmationError,
} from "@/lib/account-erasure-request";
import { configuredPrivacyVault } from "@/lib/privacy-storage";
import { erasureStatusByReceipt } from "@/lib/privacy-vault";
import { deletionReceiptSecret } from "@/lib/account-erasure-receipt";
import {
  AccountErasureConflict,
  AccountErasureCapacity,
  AccountErasureUnavailable,
} from "@/lib/account-erasure-policy";
import { RequestRateError } from "@/lib/limits-policy";
import { ACCOUNT_STATUS_HEADER } from "@/lib/account-session";
export const runtime = "nodejs";
const bodySchema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("confirm"),
      requestId: z.uuid(),
      receipt: deletionReceiptSecret,
      password: z.string().min(1).max(128),
      confirmation: z.literal("DELETE MY ACCOUNT"),
    })
    .strict(),
  z
    .object({
      action: z.literal("status"),
      requestId: z.uuid(),
      receipt: deletionReceiptSecret,
    })
    .strict(),
]);
function result(
  body: unknown,
  status = 200,
  extra: Record<string, string> = {},
) {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": "private, no-store",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
      ...extra,
    },
  });
}
export async function POST(req: Request) {
  try {
    let allowed = false;
    try {
      allowed =
        new URL(req.headers.get("origin") || "").origin ===
        new URL(process.env.BETTER_AUTH_URL || "http://127.0.0.1:3001").origin;
    } catch {}
    if (!allowed)
      return result(
        {
          error: "Open this studio to check or confirm account deletion.",
          code: "ACCOUNT_CONFIRMATION_ORIGIN",
        },
        403,
      );
    const bytes = await readLimitedBody(req, 2048, { timeoutMs: 5000 });
    let decoded: unknown;
    try {
      decoded = JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(bytes),
      );
    } catch {
      return result(
        {
          error:
            "Account deletion needs a valid confirmation or private receipt.",
          code: "ACCOUNT_CONFIRMATION_INVALID",
        },
        400,
      );
    }
    const parsed = bodySchema.safeParse(decoded);
    if (!parsed.success)
      return result(
        {
          error:
            "Account deletion needs a valid confirmation or private receipt.",
          code: "ACCOUNT_CONFIRMATION_INVALID",
        },
        400,
      );
    const input = parsed.data;
    if (input.action === "status") {
      const status = erasureStatusByReceipt(
        configuredPrivacyVault(),
        input.requestId,
        input.receipt,
      );
      return status
        ? result(status)
        : result(
            {
              error:
                "No matching deletion request was found. Check your private receipt.",
              code: "ACCOUNT_ERASURE_NOT_FOUND",
            },
            404,
          );
    }
    const { action, ...confirmation } = input;
    void action;
    return result(await confirmAccountErasure(confirmation, req.headers), 202);
  } catch (error) {
    if (error instanceof AccountConfirmationError)
      return result(
        { error: error.message, code: error.code },
        error.code === "ACCOUNT_PASSWORD_INVALID" ? 400 : error.status,
        error.code === "ACCOUNT_CHANGED"
          ? { [ACCOUNT_STATUS_HEADER]: "changed" }
          : {},
      );
    if (error instanceof AccountErasureConflict)
      return result({ error: error.message, code: error.code }, 409);
    if (error instanceof RequestRateError)
      return result(
        {
          error:
            "Too many account-deletion confirmation attempts. Try again later.",
          code: "RATE_LIMITED",
          retryAfter: error.retryAfter,
        },
        429,
        { "Retry-After": String(error.retryAfter) },
      );
    if (error instanceof RequestBodyError)
      return result(
        {
          error:
            "Account-deletion request did not finish. Keep your receipt and try again.",
          code: "ACCOUNT_CONFIRMATION_INVALID",
        },
        error.status === 408 ? 408 : 400,
      );
    if (
      error instanceof AccountErasureCapacity ||
      error instanceof AccountErasureUnavailable
    )
      return result({ error: error.message, code: error.code }, 503, {
        "Retry-After": "30",
      });
    return result(
      {
        error:
          "Account deletion is temporarily unavailable. Keep your receipt and try again.",
        code: "ACCOUNT_ERASURE_UNAVAILABLE",
      },
      503,
      { "Retry-After": "30" },
    );
  }
}
