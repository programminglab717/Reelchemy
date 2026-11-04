import { signJWT, verifyJWT } from "better-auth/crypto";
import { z } from "zod";
export class VerificationLinkInvalid extends Error {
  readonly code = "VERIFICATION_LINK_INVALID";
  constructor() {
    super("Verification link expired or invalid. Request a new one.");
    this.name = "VerificationLinkInvalid";
  }
}
const purpose = "reelchemy-email-verification-v1";
const accountSchema = z.object({
  id: z.string().min(1).max(128),
  email: z.email().max(320),
});
function validSecret(secret: string) {
  if (typeof secret !== "string" || secret.length < 32)
    throw new VerificationLinkInvalid();
}
async function payload(secret: string, token: string) {
  validSecret(secret);
  if (
    typeof token !== "string" ||
    token.length < 1 ||
    Buffer.byteLength(token) > 16384
  )
    return null;
  return await verifyJWT(token, secret);
}
// Bind the vendor-signed link to the current account ID before queueing it.
// Email-only links must never verify/autologin a later account reusing an address.
export async function bindEmailVerificationLink(
  secret: string,
  account: { id: string; email: string },
  url: string,
  trustedBase: string,
) {
  try {
    const user = accountSchema.parse(account),
      target = new URL(url),
      trusted = new URL(trustedBase);
    if (
      !["http:", "https:"].includes(target.protocol) ||
      target.origin !== trusted.origin ||
      url.length > 20000
    )
      throw new VerificationLinkInvalid();
    const old = await payload(secret, target.searchParams.get("token") || "");
    if (
      !old ||
      !z.email().max(320).safeParse(old.email).success ||
      typeof old.exp !== "number" ||
      !Number.isSafeInteger(old.exp)
    )
      throw new VerificationLinkInvalid();
    const address = (old.email as string).toLowerCase(),
      updated =
        typeof old.updateTo === "string"
          ? old.updateTo.toLowerCase()
          : undefined;
    if (
      address !== user.email.toLowerCase() &&
      updated !== user.email.toLowerCase()
    )
      throw new VerificationLinkInvalid();
    const remaining = Math.min(3600, old.exp - Math.floor(Date.now() / 1000));
    if (remaining < 1) throw new VerificationLinkInvalid();
    const token = await signJWT(
      { ...old, reelchemyUserId: user.id, reelchemyPurpose: purpose },
      secret,
      remaining,
    );
    target.searchParams.set("token", token);
    return target.toString();
  } catch {
    throw new VerificationLinkInvalid();
  }
}
export async function accountVerificationClaims(secret: string, token: string) {
  try {
    const value = await payload(secret, token);
    if (!value || value.reelchemyPurpose !== purpose) return null;
    const parsed = accountSchema.safeParse({
      id: value.reelchemyUserId,
      email: value.email,
    });
    if (!parsed.success) return null;
    return {
      accountId: parsed.data.id,
      email: parsed.data.email.toLowerCase(),
    };
  } catch {
    return null;
  }
}
export async function verificationMatchesAccount(
  secret: string,
  token: string,
  account: { id: string; email: string },
) {
  const claims = await accountVerificationClaims(secret, token);
  return (
    !!claims &&
    claims.accountId === account.id &&
    claims.email === account.email.toLowerCase()
  );
}
