import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { z } from "zod";
import { AccountErasureUnavailable } from "./account-erasure-policy";

const hex = z.string().regex(/^[a-f0-9]{64}$/);
const intentSchema = z
  .object({
    format: z.literal("reelchemy-account-erasure-v1"),
    requestId: z.uuid(),
    workspaceId: z.uuid(),
    ownerHash: hex,
    receiptHash: hex,
    requestedAt: z.iso.datetime(),
    sequence: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  })
  .strict();
export const erasureApprovalSchema = intentSchema.extend({ signature: hex });
export type ErasureApproval = z.infer<typeof erasureApprovalSchema>;
export type ErasureIntent = z.infer<typeof intentSchema>;
function validKey(key: Buffer) {
  if (!Buffer.isBuffer(key) || key.length !== 32)
    throw new AccountErasureUnavailable();
}
function canonical(intent: ErasureIntent) {
  const value = intentSchema.parse(intent);
  return JSON.stringify({
    format: value.format,
    requestId: value.requestId,
    workspaceId: value.workspaceId,
    ownerHash: value.ownerHash,
    receiptHash: value.receiptHash,
    requestedAt: value.requestedAt,
    sequence: value.sequence,
  });
}
export function erasureOwnerHash(key: Buffer, ownerId: string) {
  validKey(key);
  if (
    typeof ownerId !== "string" ||
    ownerId.length < 1 ||
    ownerId.length > 128 ||
    Buffer.byteLength(ownerId) > 512 ||
    ownerId.includes("\0")
  )
    throw new AccountErasureUnavailable();
  return createHmac("sha256", key)
    .update("reelchemy-erasure-owner-v1\0")
    .update(ownerId, "utf8")
    .digest("hex");
}
export function createErasureReceipt() {
  return randomBytes(32).toString("base64url");
}
export function erasureReceiptHash(secret: string) {
  if (typeof secret !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(secret))
    throw new AccountErasureUnavailable();
  const decoded = Buffer.from(secret, "base64url");
  if (decoded.length !== 32 || decoded.toString("base64url") !== secret)
    throw new AccountErasureUnavailable();
  return createHash("sha256")
    .update("reelchemy-erasure-receipt-v1\0")
    .update(decoded)
    .digest("hex");
}
export function erasureHashEqual(left: string, right: string) {
  return (
    hex.safeParse(left).success &&
    hex.safeParse(right).success &&
    timingSafeEqual(Buffer.from(left, "hex"), Buffer.from(right, "hex"))
  );
}
export function approveErasure(
  key: Buffer,
  intent: ErasureIntent,
): ErasureApproval {
  try {
    validKey(key);
    const value = intentSchema.parse(intent);
    const signature = createHmac("sha256", key)
      .update("reelchemy-erasure-approval-v1\0")
      .update(canonical(value))
      .digest("hex");
    return { ...value, signature };
  } catch {
    throw new AccountErasureUnavailable();
  }
}
export function verifyErasureApproval(
  key: Buffer,
  input: unknown,
): ErasureApproval {
  try {
    const value = erasureApprovalSchema.parse(input);
    const { signature, ...intent } = value;
    if (!erasureHashEqual(approveErasure(key, intent).signature, signature))
      throw new AccountErasureUnavailable();
    return value;
  } catch {
    throw new AccountErasureUnavailable();
  }
}
