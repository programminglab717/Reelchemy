import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { randomBytes, randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import {
  initializePrivacyVault,
  ownerHasErasureApproval,
  privacyVaultWatermark,
} from "../src/lib/privacy-vault";
import { createErasureReceipt } from "../src/lib/account-erasure-approval";
import { ACCOUNT_HEADER } from "../src/lib/account-session";
import { RequestRateError } from "../src/lib/limits-policy";
const root = mkdtempSync(path.join(tmpdir(), "reelchemy-confirm-erasure-"));
const vault = initializePrivacyVault(path.join(root, "privacy"));
const origin = "http://127.0.0.1:3001",
  password = "Synthetic-confirm-erasure-passphrase-4826";
Object.assign(process.env, {
  NODE_ENV: "test",
  REELCHEMY_DATA_DIR: path.join(root, "data"),
  REELCHEMY_AUTH_DIR: path.join(root, "auth"),
  REELCHEMY_ARTIFACT_DIR: path.join(root, "artifacts"),
  REELCHEMY_PRIVACY_DIR: vault.directory,
  REELCHEMY_PRIVACY_ID: vault.id,
  REELCHEMY_PRIVACY_KEY_FINGERPRINT: vault.keyFingerprint,
  BETTER_AUTH_URL: origin,
  BETTER_AUTH_SECRET: randomBytes(48).toString("base64url"),
  EMAIL_DELIVERY: "file",
  REELCHEMY_MAIL_PENDING_COUNT: "1000",
});
const { getAuth } = await import("../src/lib/auth");
const app = await import("../src/lib/db");
const { confirmAccountErasure, AccountConfirmationError } =
  await import("../src/lib/account-erasure-request");
const auth = await getAuth();
const adb = new Database(path.join(root, "auth/auth.sqlite"));
const sdb = new Database(path.join(root, "data/studio.sqlite"));
after(() => {
  adb.close();
  sdb.close();
  rmSync(root, { recursive: true, force: true });
});
async function account(email: string) {
  const signup = await auth.api.signUpEmail({
    body: { email, password, name: "Synthetic maker" },
  });
  adb.prepare("UPDATE user SET emailVerified=1 WHERE id=?").run(signup.user.id);
  const login = await auth.api.signInEmail({
    body: { email, password },
    asResponse: true,
  });
  const cookie = login.headers
    .getSetCookie()
    .map((value) => value.split(";")[0])
    .join("; ");
  return {
    id: signup.user.id,
    email,
    headers: new Headers({ cookie, origin, [ACCOUNT_HEADER]: signup.user.id }),
    workspace: app.ensureWorkspace(signup.user.id, "Synthetic maker").id,
  };
}
function input() {
  return {
    requestId: randomUUID(),
    receipt: createErasureReceipt(),
    password,
    confirmation: "DELETE MY ACCOUNT",
  };
}
function mailFor(id: string) {
  const directory = path.join(root, "auth/mail");
  return readdirSync(directory)
    .filter((file) => /^[a-f0-9-]{36}\.json$/.test(file))
    .filter(
      (file) =>
        JSON.parse(readFileSync(path.join(directory, file), "utf8"))
          .accountId === id,
    )
    .map(
      (file) =>
        [
          file,
          readFileSync(path.join(directory, file)).toString("base64"),
        ] as const,
    );
}
test("confirmation requires exact input, same-origin verified actor binding and a freshly checked password before any approval", async () => {
  const a = await account("confirm-guards@example.test"),
    value = input();
  const originalMail = mailFor(a.id);
  for (const [body, headers, status] of [
    [{ ...value, confirmation: "DELETE" }, a.headers, 400],
    [{ ...value, email: "another@example.test" }, a.headers, 400],
    [{ ...value, receipt: "A".repeat(42) + "B" }, a.headers, 400],
    [
      value,
      new Headers({
        ...Object.fromEntries(a.headers),
        origin: "https://other.example.test",
      }),
      403,
    ],
    [
      value,
      new Headers({
        ...Object.fromEntries(a.headers),
        [ACCOUNT_HEADER]: "another-identity",
      }),
      409,
    ],
    [{ ...value, password: "wrong-password" }, a.headers, 401],
  ] as const)
    await assert.rejects(
      () => confirmAccountErasure(body, headers),
      (error: unknown) =>
        error instanceof AccountConfirmationError && error.status === status,
    );
  assert.equal(ownerHasErasureApproval(vault, a.id), false);
  assert.deepEqual(mailFor(a.id), originalMail);
  assert.equal(privacyVaultWatermark(vault).sequence, 0);
});
test("accepted confirmation installs studio barriers, revokes sessions and returns only receipt status; a lost reply replays without a session", async () => {
  const a = await account("confirm-accepted@example.test"),
    b = await account("confirm-other@example.test");
  const brief = {
    prompt: "Original private film",
    duration: 5,
    format: "landscape" as const,
  };
  const pa = app.createProject(brief, a.workspace),
    pb = app.createProject(brief, b.workspace);
  const original = readFileSync(path.join(root, "data/studio.sqlite"));
  assert(original.length > 0);
  const beforeOther = sdb
      .prepare("SELECT * FROM projects WHERE id=?")
      .get(pb.id),
    otherMail = mailFor(b.id),
    value = input();
  const result = await confirmAccountErasure(value, a.headers);
  assert.equal(result.state, "cleaning");
  assert.equal(result.requestId, value.requestId);
  assert.deepEqual(Object.keys(result).sort(), [
    "requestId",
    "requestedAt",
    "state",
    "updatedAt",
  ]);
  const dto = JSON.stringify(result);
  for (const secret of [a.id, a.email, password, value.receipt, root])
    assert(!dto.includes(secret));
  assert.equal(await auth.api.getSession({ headers: a.headers }), null);
  assert.equal(
    (
      adb
        .prepare("SELECT count(*) n FROM session WHERE userId=?")
        .get(a.id) as { n: number }
    ).n,
    0,
  );
  assert.equal(app.projectInWorkspace(pa.id, a.workspace, true), false);
  assert(sdb.prepare("SELECT trashed_at FROM projects WHERE id=?").get(pa.id));
  assert.equal(mailFor(a.id).length, 0);
  assert.deepEqual(mailFor(b.id), otherMail);
  assert.deepEqual(
    sdb.prepare("SELECT * FROM projects WHERE id=?").get(pb.id),
    beforeOther,
  );
  assert.equal(
    (await auth.api.getSession({ headers: b.headers }))?.user.id,
    b.id,
  );
  // A valid private receipt is sufficient for status only, even when the browser
  // now belongs to B; it does not mutate B or emit any SDK cookie headers.
  assert.deepEqual(
    await confirmAccountErasure(
      { ...value, password: "unused-on-replay" },
      b.headers,
    ),
    result,
  );
  assert.equal(
    (await auth.api.getSession({ headers: b.headers }))?.user.id,
    b.id,
  );
});
test("an irreversible approval remains accepted and blocked if studio admission fails; session revocation still runs", async () => {
  const a = await account("confirm-blocked@example.test"),
    value = input();
  const begin = app.accountErasures.begin;
  app.accountErasures.begin = () => {
    throw new Error("Synthetic storage failure");
  };
  try {
    const result = await confirmAccountErasure(value, a.headers);
    assert.equal(result.state, "blocked");
    assert.equal(ownerHasErasureApproval(vault, a.id), true);
    assert.equal(
      (
        adb
          .prepare("SELECT count(*) n FROM session WHERE userId=?")
          .get(a.id) as { n: number }
      ).n,
      0,
    );
    assert.deepEqual(
      await confirmAccountErasure(value, new Headers({ origin })),
      result,
    );
  } finally {
    app.accountErasures.begin = begin;
  }
});
test("failed fresh-password attempts have a persisted per-studio hourly allowance and never create deletion intent", async () => {
  const a = await account("confirm-rate@example.test");
  for (let index = 0; index < 5; index++)
    await assert.rejects(
      () =>
        confirmAccountErasure(
          { ...input(), password: "wrong-password" },
          a.headers,
        ),
      AccountConfirmationError,
    );
  await assert.rejects(
    () => confirmAccountErasure(input(), a.headers),
    RequestRateError,
  );
  assert.equal(ownerHasErasureApproval(vault, a.id), false);
  assert.equal(
    (
      sdb
        .prepare(
          "SELECT hits FROM request_limits WHERE workspace_id=? AND operation='account-erasure-confirmation'",
        )
        .get(a.workspace) as { hits: number }
    ).hits,
    5,
  );
});
test("a session revoked during password verification cannot commit a deletion intent", async () => {
  const a = await account("confirm-session-race@example.test");
  const value = input();
  const runtime = await auth.$context;
  const verify = runtime.password.verify;
  const originalMail = mailFor(a.id);
  runtime.password.verify = async (credentials) => {
    const result = await verify(credentials);
    adb.prepare("DELETE FROM session WHERE userId=?").run(a.id);
    return result;
  };
  try {
    await assert.rejects(
      () => confirmAccountErasure(value, a.headers),
      (error: unknown) =>
        error instanceof AccountConfirmationError &&
        error.code === "ACCOUNT_EXPIRED",
    );
    assert.equal(ownerHasErasureApproval(vault, a.id), false);
    assert.deepEqual(mailFor(a.id), originalMail);
  } finally {
    runtime.password.verify = verify;
  }
});
