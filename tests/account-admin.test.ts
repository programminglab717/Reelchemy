import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import Database from "better-sqlite3";

const root = await mkdtemp(path.join(tmpdir(), "reelchemy-account-admin-"));
after(() => rm(root, { recursive: true, force: true }));
const environment: NodeJS.ProcessEnv = {
  ...process.env,
  REELCHEMY_DATA_DIR: path.join(root, "data"),
  REELCHEMY_AUTH_DIR: path.join(root, "auth"),
  REELCHEMY_PUBLIC_SIGNUP: "false",
};
function admin(args: string[], password?: string) {
  return new Promise<{ code: number | null; output: string }>(
    (resolve, reject) => {
      const child = spawn(
        process.execPath,
        ["--import", "tsx", "scripts/account-admin.ts", ...args],
        { env: environment, stdio: ["pipe", "pipe", "pipe"] },
      );
      let output = "";
      child.stdout.on("data", (b) => (output += b.toString()));
      child.stderr.on("data", (b) => (output += b.toString()));
      child.once("error", reject);
      child.once("close", (code) => resolve({ code, output }));
      child.stdin.end(password ?? "");
    },
  );
}
const email = "Owner@Example.test",
  first = "Operator-created-passphrase-1",
  second = "Operator-changed-passphrase-2";

test("operators create a verified account while public sign-up is closed and reset its password without echoing it", async () => {
  const created = await admin(
    ["create", "--email", email, "--name", "Studio owner", "--password-stdin"],
    `${first}\n`,
  );
  assert.equal(created.code, 0, created.output);
  assert.match(created.output, /"verified":true/);
  assert(!created.output.includes(first));
  const auth = new Database(path.join(root, "auth", "auth.sqlite"), {
    readonly: true,
  });
  try {
    const user = auth
      .prepare('SELECT id,email,emailVerified FROM "user" WHERE email=?')
      .get("owner@example.test") as { id: string; emailVerified: number };
    assert.equal(user.emailVerified, 1);
  } finally {
    auth.close();
  }
  const duplicate = await admin(
    ["create", "--email", email, "--name", "Again", "--password-stdin"],
    first,
  );
  assert.equal(duplicate.code, 65);
  // Public sign-up stays closed for everyone else.
  Object.assign(process.env, environment);
  const { getAuth } = await import("../src/lib/auth");
  const api = await getAuth();
  await assert.rejects(
    api.api.signUpEmail({
      body: {
        name: "Visitor",
        email: "visitor@example.test",
        password: "Visitor-passphrase-123",
      },
    }),
  );
  const signedIn = await api.api.signInEmail({
    body: { email: "owner@example.test", password: first },
  });
  assert(signedIn.token);
  const changed = await admin(
    ["password", "--email", email, "--password-stdin"],
    second,
  );
  assert.equal(changed.code, 0, changed.output);
  assert(!changed.output.includes(second));
  await assert.rejects(
    api.api.signInEmail({
      body: { email: "owner@example.test", password: first },
    }),
  );
  assert(
    (
      await api.api.signInEmail({
        body: { email: "owner@example.test", password: second },
      })
    ).token,
  );
  for (const args of [
    ["create", "--email", "not-an-email", "--name", "X", "--password-stdin"],
    ["password", "--email", email],
    ["remove", "--email", email, "--password-stdin"],
  ])
    assert.equal((await admin(args, second)).code, 64);
  assert.equal(
    (await admin(["password", "--email", email, "--password-stdin"], "short"))
      .code,
    64,
  );
});
