import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { signJWT, verifyJWT } from "better-auth/crypto";
import {
  bindEmailVerificationLink,
  accountVerificationClaims,
  verificationMatchesAccount,
  VerificationLinkInvalid,
} from "../src/lib/email-verification";
const origin = "https://studio.example.test",
  owner = { id: "original-private-owner", email: "maker@example.test" };
test("verification is bound to an account ID so old links cannot autologin a later owner of the same address", async () => {
  const secret = randomBytes(48).toString("base64url"),
    legacy = await signJWT({ email: owner.email }, secret, 3600),
    source = `${origin}/api/auth/verify-email?token=${legacy}&callbackURL=%2F`;
  const bound = new URL(
      await bindEmailVerificationLink(secret, owner, source, origin),
    ),
    token = bound.searchParams.get("token")!;
  assert.equal(bound.origin, origin);
  assert.equal(bound.searchParams.get("callbackURL"), "/");
  assert.notEqual(token, legacy);
  assert.equal(await accountVerificationClaims(secret, legacy), null);
  assert.deepEqual(await accountVerificationClaims(secret, token), {
    accountId: owner.id,
    email: owner.email,
  });
  assert(await verificationMatchesAccount(secret, token, owner));
  assert(
    !(await verificationMatchesAccount(secret, token, {
      ...owner,
      id: "new-private-owner-same-email",
    })),
  );
  assert(
    !(await verificationMatchesAccount(secret, token, {
      ...owner,
      email: "other@example.test",
    })),
  );
  assert(
    !(await verificationMatchesAccount(
      randomBytes(48).toString("base64url"),
      token,
      owner,
    )),
  );
  const decoded = await verifyJWT(token, secret);
  assert(decoded);
  assert((decoded.exp as number) <= (await verifyJWT(legacy, secret))!.exp!);
});
test("vendor email-change payloads keep their scope while still binding the original identity", async () => {
  const secret = randomBytes(48).toString("base64url"),
    legacy = await signJWT(
      {
        email: owner.email,
        updateTo: "new-address@example.test",
        requestType: "change-email-verification",
      },
      secret,
      3600,
    ),
    source = `${origin}/api/auth/verify-email?token=${legacy}&callbackURL=%2Fsettings`;
  const target = new URL(
      await bindEmailVerificationLink(
        secret,
        { ...owner, email: "new-address@example.test" },
        source,
        origin,
      ),
    ),
    token = target.searchParams.get("token")!,
    decoded = await verifyJWT(token, secret);
  assert.equal(decoded?.updateTo, "new-address@example.test");
  assert.equal(decoded?.requestType, "change-email-verification");
  assert.equal(target.searchParams.get("callbackURL"), "/settings");
  assert(await verificationMatchesAccount(secret, token, owner));
});
test("wrong-origin, expired, malformed and unrelated signed links cannot be rebound or mistaken for verification", async () => {
  const secret = randomBytes(48).toString("base64url"),
    valid = await signJWT({ email: owner.email }, secret, 3600);
  for (const token of [
    "malformed",
    await signJWT({ email: owner.email }, secret, -1),
    await signJWT({ email: "unrelated@example.test" }, secret, 3600),
    "a".repeat(16385),
  ])
    await assert.rejects(
      () =>
        bindEmailVerificationLink(
          secret,
          owner,
          `${origin}/api/auth/verify-email?token=${token}`,
          origin,
        ),
      VerificationLinkInvalid,
    );
  await assert.rejects(
    () =>
      bindEmailVerificationLink(
        secret,
        owner,
        `https://other.example.test/api/auth/verify-email?token=${valid}`,
        origin,
      ),
    VerificationLinkInvalid,
  );
  assert.equal(await accountVerificationClaims(secret, "malformed"), null);
  assert.equal(
    await accountVerificationClaims(
      secret,
      await signJWT(
        {
          email: owner.email,
          reelchemyUserId: owner.id,
          reelchemyPurpose: "other-purpose",
        },
        secret,
        3600,
      ),
    ),
    null,
  );
});
