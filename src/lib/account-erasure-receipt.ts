import { z } from "zod";
export const deletionReceiptSecret = z
  .string()
  .regex(/^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/);
export const deletionReceiptSchema = z
  .object({
    format: z.literal("reelchemy-account-deletion-receipt-v1"),
    requestId: z.uuid(),
    receipt: deletionReceiptSecret,
    createdAt: z.iso.datetime(),
  })
  .strict();
export type DeletionReceipt = z.infer<typeof deletionReceiptSchema>;
export const deletionStatusSchema = z
  .object({
    requestId: z.uuid(),
    state: z.enum(["requested", "cleaning", "blocked", "completed"]),
    requestedAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .strict();
export type DeletionStatus = z.infer<typeof deletionStatusSchema>;
export function createDeletionReceipt(): DeletionReceipt {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const receipt = btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
  return deletionReceiptSchema.parse({
    format: "reelchemy-account-deletion-receipt-v1",
    requestId: crypto.randomUUID(),
    receipt,
    createdAt: new Date().toISOString(),
  });
}
export function parseDeletionReceipt(text: string) {
  if (new TextEncoder().encode(text).length > 2048)
    throw new Error(
      "Choose the small private account-deletion receipt downloaded from this studio.",
    );
  try {
    return deletionReceiptSchema.parse(JSON.parse(text));
  } catch {
    throw new Error("This file is not a supported account-deletion receipt.");
  }
}
