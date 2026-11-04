import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat, access } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { randomBytes, randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import type { ChildProcess } from "node:child_process";
import {
  spawnTestProcess,
  shutdownTestProcesses,
} from "../scripts/test-process";
import {
  initializePrivacyVault,
  erasureStatusByReceipt,
} from "../src/lib/privacy-vault";
import { createErasureReceipt } from "../src/lib/account-erasure-approval";
import { ACCOUNT_HEADER } from "../src/lib/account-session";
const root = await mkdtemp(path.join(tmpdir(), "reelchemy-private-worker-")),
  vault = initializePrivacyVault(path.join(root, "privacy"));
const origin = "http://127.0.0.1:3001",
  password = "Synthetic-private-worker-passphrase-4826";
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
const { getAuth } = await import("../src/lib/auth"),
  auth = await getAuth();
const app = await import("../src/lib/db");
const { confirmAccountErasure } =
  await import("../src/lib/account-erasure-request");
const { privacyWorkerHealthy } =
  await import("../src/lib/privacy-worker-state");
const db = new Database(path.join(root, "auth/auth.sqlite")),
  children: ChildProcess[] = [];
after(async () => {
  await shutdownTestProcesses(children);
  db.close();
  await rm(root, { recursive: true, force: true });
});
async function waitFor(
  check: () => boolean | Promise<boolean>,
  message: string,
) {
  const end = Date.now() + 15000;
  while (Date.now() < end) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(message);
}
function start() {
  const child = spawnTestProcess(
    process.execPath,
    ["--import", "tsx", "scripts/privacy-entrypoint.ts"],
    {
      env: {
        ...process.env,
        NODE_ENV: "production",
        SMTP_PASSWORD: "synthetic-must-not-reach-cleanup",
        AI_API_KEY: "synthetic-must-not-reach-cleanup",
      },
      stdio: ["ignore", "ignore", "pipe"],
    },
  );
  children.push(child);
  let errors = "";
  child.stderr?.on("data", (data) => {
    errors = (errors + String(data)).slice(-4000);
  });
  const closed = new Promise<number | null>((resolve) =>
    child.once("close", resolve),
  );
  return { child, closed, errors: () => errors };
}
test(
  "real credential-free privacy consumer completes an approved empty studio, excludes duplicates and recovers SIGKILL without replacing its lifecycle inode",
  { timeout: 45000 },
  async () => {
    const signup = await auth.api.signUpEmail({
      body: {
        email: "private-consumer@example.test",
        password,
        name: "Private consumer maker",
      },
    });
    db.prepare("UPDATE user SET emailVerified=1 WHERE id=?").run(
      signup.user.id,
    );
    const login = await auth.api.signInEmail({
      body: { email: "private-consumer@example.test", password },
      asResponse: true,
    });
    app.ensureWorkspace(signup.user.id, "Maker");
    const headers = new Headers({
      origin,
      [ACCOUNT_HEADER]: signup.user.id,
      cookie: login.headers
        .getSetCookie()
        .map((value) => value.split(";")[0])
        .join("; "),
    });
    const value = {
      requestId: randomUUID(),
      receipt: createErasureReceipt(),
      password,
      confirmation: "DELETE MY ACCOUNT",
    };
    await confirmAccountErasure(value, headers);
    const first = start();
    await waitFor(() => {
      if (first.child.exitCode !== null) throw new Error(first.errors());
      return privacyWorkerHealthy();
    }, "Private consumer did not become healthy.");
    await waitFor(
      () =>
        erasureStatusByReceipt(vault, value.requestId, value.receipt)?.state ===
        "completed",
      "Private consumer did not finish approved cleanup.",
    );
    assert.equal(
      db.prepare("SELECT id FROM user WHERE id=?").get(signup.user.id),
      undefined,
    );
    const directory = path.join(root, "auth/privacy-worker"),
      lock = path.join(directory, "worker.lifecycle.lock");
    const inode = (await stat(lock)).ino;
    const heartbeat = JSON.parse(
      await readFile(path.join(directory, "heartbeat.json"), "utf8"),
    );
    const environment = (
      await readFile(`/proc/${heartbeat.pid}/environ`, "utf8")
    ).split("\0");
    for (const prefix of ["BETTER_AUTH_", "SMTP_", "AI_", "EMAIL_"])
      assert(!environment.some((value) => value.startsWith(prefix)), prefix);
    const duplicate = start();
    assert.equal(await duplicate.closed, 1);
    assert.match(duplicate.errors(), /Another privacy worker/);
    assert.equal((await stat(lock)).ino, inode);
    assert(privacyWorkerHealthy());
    process.kill(heartbeat.pid, "SIGKILL");
    await first.closed;
    assert.equal(privacyWorkerHealthy(), false);
    const replacement = start();
    await waitFor(() => {
      if (replacement.child.exitCode !== null)
        throw new Error(replacement.errors());
      return privacyWorkerHealthy();
    }, "Private consumer did not recover after SIGKILL.");
    assert.equal((await stat(lock)).ino, inode);
    const next = JSON.parse(
      await readFile(path.join(directory, "heartbeat.json"), "utf8"),
    );
    assert.notEqual(next.instanceId, heartbeat.instanceId);
    assert.equal(
      erasureStatusByReceipt(vault, value.requestId, value.receipt)?.state,
      "completed",
    );
    await shutdownTestProcesses([replacement.child]);
    assert.equal(privacyWorkerHealthy(), false);
    await assert.rejects(() => access(path.join(directory, "heartbeat.json")));
    assert.equal((await stat(lock)).ino, inode);
  },
);
