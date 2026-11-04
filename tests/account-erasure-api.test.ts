import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, rename } from "node:fs/promises";
import { randomBytes, randomUUID } from "node:crypto";
import path from "node:path";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";
import {
  initializePrivacyVault,
  ownerHasErasureApproval,
} from "../src/lib/privacy-vault";
import { createDeletionReceipt } from "../src/lib/account-erasure-receipt";
import {
  ACCOUNT_HEADER,
  ACCOUNT_STATUS_HEADER,
} from "../src/lib/account-session";
const root = await mkdtemp(
    path.join(tmpdir(), "reelchemy-account-delete-api-"),
  ),
  vault = initializePrivacyVault(path.join(root, "privacy")),
  origin = "http://127.0.0.1:3001",
  password = "Synthetic-delete-api-passphrase-4826";
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
});
const { getAuth } = await import("../src/lib/auth"),
  auth = await getAuth(),
  app = await import("../src/lib/db"),
  { POST } = await import("../src/app/api/account/deletion/route");
const db = new Database(path.join(root, "auth/auth.sqlite"));
after(async () => {
  db.close();
  await rm(root, { recursive: true, force: true });
});
async function account(email: string) {
  const signup = await auth.api.signUpEmail({
    body: { email, password, name: "Deletion API maker" },
  });
  db.prepare("UPDATE user SET emailVerified=1 WHERE id=?").run(signup.user.id);
  const login = await auth.api.signInEmail({
    body: { email, password },
    asResponse: true,
  });
  return {
    id: signup.user.id,
    cookie: login.headers
      .getSetCookie()
      .map((value) => value.split(";")[0])
      .join("; "),
  };
}
function call(body: unknown, cookie = "", actor?: string) {
  return POST(
    new Request(origin + "/api/account/deletion", {
      method: "POST",
      headers: {
        origin,
        cookie,
        "content-type": "application/json",
        ...(actor ? { [ACCOUNT_HEADER]: actor } : {}),
      },
      body: JSON.stringify(body),
    }),
  );
}
function confirmation(receipt: ReturnType<typeof createDeletionReceipt>) {
  return {
    action: "confirm",
    requestId: receipt.requestId,
    receipt: receipt.receipt,
    password,
    confirmation: "DELETE MY ACCOUNT",
  };
}
function privateOnly(response: Response) {
  assert.match(
    response.headers.get("cache-control") || "",
    /private.*no-store/,
  );
  assert.equal(response.headers.get("referrer-policy"), "no-referrer");
  assert.equal(response.headers.get("set-cookie"), null);
}
test("HTTP confirmation validates origin/body/actor/password and provides cookie-free receipt status/replay while a different account stays usable", async () => {
  const a = await account("api-erased@example.test"),
    b = await account("api-kept@example.test"),
    receipt = createDeletionReceipt();
  const workspace = app.ensureWorkspace(b.id, "B"),
    kept = app.createProject(
      { prompt: "Untouched API film", duration: 5, format: "landscape" },
      workspace.id,
    );
  const wrongPassword = await call(
    { ...confirmation(receipt), password: "wrong-password" },
    a.cookie,
    a.id,
  );
  assert.equal(wrongPassword.status, 400);
  privateOnly(wrongPassword);
  assert.equal((await wrongPassword.json()).code, "ACCOUNT_PASSWORD_INVALID");
  assert.equal(
    (await auth.api.getSession({ headers: new Headers({ cookie: a.cookie }) }))
      ?.user.id,
    a.id,
  );
  const changed = await call(confirmation(receipt), b.cookie, a.id);
  assert.equal(changed.status, 409);
  assert.equal(changed.headers.get(ACCOUNT_STATUS_HEADER), "changed");
  privateOnly(changed);
  for (const body of [
    { ...confirmation(receipt), email: "foreign@example.test" },
    { ...confirmation(receipt), receipt: "A".repeat(42) + "B" },
    { ...confirmation(receipt), password: "x".repeat(2049) },
  ])
    assert.equal((await call(body, a.cookie, a.id)).status, 400);
  assert.equal(ownerHasErasureApproval(vault, a.id), false);
  const accepted = await call(confirmation(receipt), a.cookie, a.id);
  assert.equal(accepted.status, 202);
  privateOnly(accepted);
  const status = await accepted.json();
  assert.equal(status.requestId, receipt.requestId);
  assert.deepEqual(Object.keys(status).sort(), [
    "requestId",
    "requestedAt",
    "state",
    "updatedAt",
  ]);
  for (const value of [a.id, password, receipt.receipt, root])
    assert(!JSON.stringify(status).includes(value));
  assert.equal(
    await auth.api.getSession({ headers: new Headers({ cookie: a.cookie }) }),
    null,
  );
  const checked = await call({
    action: "status",
    requestId: receipt.requestId,
    receipt: receipt.receipt,
  });
  assert.equal(checked.status, 200);
  privateOnly(checked);
  assert.deepEqual(await checked.json(), status);
  const replay = await call(
    { ...confirmation(receipt), password: "unused-on-status-replay" },
    b.cookie,
    a.id,
  );
  assert.equal(replay.status, 202);
  privateOnly(replay);
  assert.deepEqual(await replay.json(), status);
  const wrong = await call({
      action: "status",
      requestId: receipt.requestId,
      receipt: createDeletionReceipt().receipt,
    }),
    missing = await call({
      action: "status",
      requestId: randomUUID(),
      receipt: receipt.receipt,
    });
  assert.equal(wrong.status, 404);
  assert.equal(missing.status, 404);
  assert.deepEqual(await wrong.json(), await missing.json());
  privateOnly(wrong);
  assert.equal(
    (await auth.api.getSession({ headers: new Headers({ cookie: b.cookie }) }))
      ?.user.id,
    b.id,
  );
  assert.equal(app.getProject(kept.id)?.name, kept.name);
});
test("cross-origin requests do not read a body, interrupted bodies finish privately, and missing authority never returns a raw diagnostic", async () => {
  let reads = 0;
  const stream = new ReadableStream<Uint8Array>(
    {
      pull() {
        reads++;
        throw new Error("Do not read this body");
      },
    },
    { highWaterMark: 0 },
  );
  const foreign = new Request(origin + "/api/account/deletion", {
    method: "POST",
    headers: { origin: "https://other.example.test" },
    body: stream,
    duplex: "half",
  } as RequestInit);
  const refused = await POST(foreign);
  assert.equal(refused.status, 403);
  assert.equal(reads, 0);
  privateOnly(refused);
  await stream.cancel();
  const controller = new AbortController();
  let cancelled = false;
  const pending = new ReadableStream<Uint8Array>(
    {
      cancel() {
        cancelled = true;
      },
    },
    { highWaterMark: 0 },
  );
  const request = new Request(origin + "/api/account/deletion", {
    method: "POST",
    headers: { origin },
    body: pending,
    signal: controller.signal,
    duplex: "half",
  } as RequestInit);
  const response = POST(request);
  setTimeout(() => controller.abort(), 20);
  const interrupted = await response;
  assert.equal(interrupted.status, 408);
  privateOnly(interrupted);
  assert(cancelled);
  const file = path.join(vault.directory, "vault.json");
  await rename(file, file + ".held");
  try {
    const unavailable = await call({
      action: "status",
      requestId: randomUUID(),
      receipt: createDeletionReceipt().receipt,
    });
    assert.equal(unavailable.status, 503);
    privateOnly(unavailable);
    const text = await unavailable.text();
    assert(!text.includes(root));
    assert(!text.includes(vault.id));
    assert(!text.includes(vault.keyFingerprint));
  } finally {
    await rename(file + ".held", file);
  }
});
