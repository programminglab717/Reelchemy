import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm, rename } from "node:fs/promises";
import { randomBytes, randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { signJWT } from "better-auth/crypto";
import {
  initializePrivacyVault,
  recordErasureApproval,
} from "../src/lib/privacy-vault";
import { createErasureReceipt } from "../src/lib/account-erasure-approval";
import {
  revokeApprovedAuthSessions,
  finishApprovedAuthErasure,
} from "../src/lib/auth-erasure-store";

const root = await mkdtemp(
  path.join(tmpdir(), "reelchemy-auth-privacy-runtime-"),
);
const vault = initializePrivacyVault(path.join(root, "privacy"));
const origin = "http://127.0.0.1:3001";
Object.assign(process.env, {
  NODE_ENV: "test",
  REELCHEMY_DATA_DIR: path.join(root, "data"),
  REELCHEMY_AUTH_DIR: path.join(root, "auth"),
  REELCHEMY_ARTIFACT_DIR: path.join(root, "artifacts"),
  REELCHEMY_PRIVACY_DIR: vault.directory,
  REELCHEMY_PRIVACY_ID: vault.id,
  REELCHEMY_PRIVACY_KEY_FINGERPRINT: vault.keyFingerprint,
  REELCHEMY_MAIL_PENDING_COUNT: "1000",
  EMAIL_DELIVERY: "file",
  BETTER_AUTH_URL: origin,
  BETTER_AUTH_SECRET: randomBytes(48).toString("base64url"),
});
const { getAuth } = await import("../src/lib/auth");
const { GET, POST } = await import("../src/app/api/auth/[...all]/route");
const auth = await getAuth();
const db = new Database(path.join(root, "auth/auth.sqlite"));
after(async () => {
  db.close();
  await rm(root, { recursive: true, force: true });
});
const password = "Synthetic-private-passphrase-4826";
function cookies(response: Response) {
  return response.headers
    .getSetCookie()
    .map((value) => value.split(";")[0])
    .join("; ");
}
async function signup(email: string) {
  const result = await auth.api.signUpEmail({
    body: { email, password, name: "Privacy maker" },
  });
  const directory = path.join(root, "auth/mail");
  for (const file of await readdir(directory)) {
    if (!/^[a-f0-9-]{36}\.json$/.test(file)) continue;
    const mail = JSON.parse(await readFile(path.join(directory, file), "utf8"));
    if (mail.accountId === result.user.id) {
      const url = mail.text.match(/http:\/\/\S+/)?.[0];
      assert(url);
      return { id: result.user.id, email, url };
    }
  }
  throw new Error("Synthetic verification mail missing.");
}
function approve(ownerId: string) {
  const context = {
    ownerId,
    workspaceId: randomUUID(),
    requestId: randomUUID(),
    receipt: createErasureReceipt(),
  };
  recordErasureApproval(vault, context);
  return context;
}
test("real queued bound verification succeeds; email-only and wrong-purpose tokens cannot verify an account", async () => {
  const maker = await signup("binding-runtime@example.test");
  for (const claims of [
    { email: maker.email },
    {
      email: maker.email,
      reelchemyUserId: maker.id,
      reelchemyPurpose: "another-purpose",
    },
  ]) {
    const token = await signJWT(claims, process.env.BETTER_AUTH_SECRET!, 3600);
    const response = await GET(
      new Request(
        `${origin}/api/auth/verify-email?token=${token}&callbackURL=%2F`,
      ),
    );
    assert.equal(response.status, 400);
    assert.equal(response.headers.get("set-cookie"), null);
    assert.equal(response.headers.get("referrer-policy"), "no-referrer");
    assert.equal(
      (
        db
          .prepare("SELECT emailVerified FROM user WHERE id=?")
          .get(maker.id) as { emailVerified: number }
      ).emailVerified,
      0,
    );
  }
  const verified = await GET(new Request(maker.url));
  assert.equal(verified.status, 302);
  assert.equal(
    (
      await auth.api.getSession({
        headers: new Headers({ cookie: cookies(verified) }),
      })
    )?.user.id,
    maker.id,
  );
});
test("a deleted account's real verification link cannot verify or sign in a later account reusing its email", async () => {
  const original = await signup("address-reuse-runtime@example.test");
  const context = approve(original.id);
  revokeApprovedAuthSessions(db, vault, context);
  finishApprovedAuthErasure(db, vault, context);
  const replacement = await signup(original.email);
  assert.notEqual(original.id, replacement.id);
  const refused = await GET(new Request(original.url));
  assert.equal(refused.status, 400);
  assert.equal(refused.headers.get("set-cookie"), null);
  assert.equal(
    (
      db
        .prepare("SELECT emailVerified FROM user WHERE id=?")
        .get(replacement.id) as { emailVerified: number }
    ).emailVerified,
    0,
  );
  const browser = await GET(
    new Request(original.url, { headers: { accept: "text/html" } }),
  );
  assert.equal(browser.status, 302);
  assert.equal(
    browser.headers.get("location"),
    `${origin}/sign-in?mode=verify&notice=verification`,
  );
  assert.equal(browser.headers.get("set-cookie"), null);
  const verified = await GET(new Request(replacement.url));
  assert.equal(verified.status, 302);
  assert.equal(
    (
      await auth.api.getSession({
        headers: new Headers({ cookie: cookies(verified) }),
      })
    )?.user.id,
    replacement.id,
  );
});
test("independent approval immediately hides an existing session before local revocation and preserves another signed-in identity", async () => {
  const a = await signup("revocation-runtime@example.test");
  const verifiedA = await GET(new Request(a.url));
  const cookieA = cookies(verifiedA);
  assert.equal(
    (await auth.api.getSession({ headers: new Headers({ cookie: cookieA }) }))
      ?.user.id,
    a.id,
  );
  approve(a.id);
  assert.equal(
    await auth.api.getSession({ headers: new Headers({ cookie: cookieA }) }),
    null,
  );
  const refused = await GET(
    new Request(`${origin}/api/auth/get-session`, {
      headers: { cookie: cookieA },
    }),
  );
  assert.equal(refused.status, 200);
  assert.equal(await refused.json(), null);
  assert.equal(refused.headers.get("set-cookie"), null);
  const mutation = await POST(
    new Request(`${origin}/api/auth/update-user`, {
      method: "POST",
      headers: { origin, cookie: cookieA, "content-type": "application/json" },
      body: JSON.stringify({ name: "Must not save" }),
    }),
  );
  assert.equal(mutation.status, 401);
  assert.equal(
    (
      db.prepare("SELECT name FROM user WHERE id=?").get(a.id) as {
        name: string;
      }
    ).name,
    "Privacy maker",
  );
  const other = db
    .prepare("SELECT id FROM user WHERE email=?")
    .get("address-reuse-runtime@example.test") as { id: string };
  const login = await auth.api.signInEmail({
    body: { email: "address-reuse-runtime@example.test", password },
    asResponse: true,
  });
  assert.equal(
    (
      await auth.api.getSession({
        headers: new Headers({ cookie: cookies(login) }),
      })
    )?.user.id,
    other.id,
  );
  assert.equal(
    (
      db.prepare("SELECT count(*) n FROM session WHERE userId=?").get(a.id) as {
        n: number;
      }
    ).n,
    1,
    "private approval is authoritative even while the local session still exists",
  );
});
test("missing independent storage fails an existing session closed with a fixed private error", async () => {
  const login = await auth.api.signInEmail({
    body: { email: "address-reuse-runtime@example.test", password },
    asResponse: true,
  });
  const marker = path.join(vault.directory, "vault.json");
  await rename(marker, marker + ".held");
  try {
    const response = await GET(
      new Request(`${origin}/api/auth/get-session`, {
        headers: { cookie: cookies(login) },
      }),
    );
    assert.equal(response.status, 503);
    assert.equal(response.headers.get("set-cookie"), null);
    const body = await response.text();
    for (const privateValue of [
      root,
      vault.id,
      vault.keyFingerprint,
      "address-reuse-runtime@example.test",
    ])
      assert(!body.includes(privateValue));
  } finally {
    await rename(marker + ".held", marker);
  }
});
test("address reuse between verification lookup and UPDATE cannot verify the replacement identity", async () => {
  const original = await signup("verify-update-race@example.test");
  const runtime = await auth.$context;
  const adapter = runtime.internalAdapter;
  const update = adapter.updateUser;
  let replacementId = "";
  adapter.updateUser = async (id, data) => {
    assert.equal(id, original.id);
    const context = approve(original.id);
    revokeApprovedAuthSessions(db, vault, context);
    finishApprovedAuthErasure(db, vault, context);
    replacementId = (await signup(original.email)).id;
    return update(id, data);
  };
  try {
    const response = await GET(new Request(original.url));
    assert(response.status >= 400);
    assert.equal(response.headers.get("set-cookie"), null);
    assert(replacementId);
    assert.notEqual(replacementId, original.id);
    assert.equal(
      (
        db
          .prepare("SELECT emailVerified FROM user WHERE id=?")
          .get(replacementId) as { emailVerified: number }
      ).emailVerified,
      0,
    );
    assert.equal(
      (
        db
          .prepare("SELECT count(*) n FROM session WHERE userId=?")
          .get(replacementId) as { n: number }
      ).n,
      0,
    );
  } finally {
    adapter.updateUser = update;
  }
});
