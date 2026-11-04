import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile, stat, access } from "node:fs/promises";
import { randomBytes, createHash, randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import sharp from "sharp";
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
import { blankTimeline } from "../src/lib/editor";
import { ACCOUNT_HEADER } from "../src/lib/account-session";
import { HEARTBEAT_NAME, recentHeartbeat } from "../src/lib/worker-heartbeat";
import { providerBudgetPolicy } from "../src/lib/provider-budget-policy";
import { providerUsageSummary } from "../src/lib/provider-usage-store";

const root = await mkdtemp(
  path.join(tmpdir(), "reelchemy-account-native-cleanup-"),
);
const vault = initializePrivacyVault(path.join(root, "privacy"));
const origin = "http://127.0.0.1:3001",
  password = "Synthetic-native-erasure-passphrase-4826";
Object.assign(process.env, {
  NODE_ENV: "test",
  REELCHEMY_DATA_DIR: path.join(root, "data"),
  REELCHEMY_AUTH_DIR: path.join(root, "auth"),
  REELCHEMY_ARTIFACT_DIR: path.join(root, "artifacts"),
  REELCHEMY_RENDER_CACHE_DIR: path.join(root, "cache"),
  REELCHEMY_PRIVACY_DIR: vault.directory,
  REELCHEMY_PRIVACY_ID: vault.id,
  REELCHEMY_PRIVACY_KEY_FINGERPRINT: vault.keyFingerprint,
  BETTER_AUTH_URL: origin,
  BETTER_AUTH_SECRET: randomBytes(48).toString("base64url"),
  EMAIL_DELIVERY: "file",
  AI_PROVIDER: "mock",
  REELCHEMY_MAIL_PENDING_COUNT: "1000",
});
const { getAuth, accountAuthContext } = await import("../src/lib/auth");
const app = await import("../src/lib/db");
const { storeImage } = await import("../src/lib/assets");
const { confirmAccountErasure } =
  await import("../src/lib/account-erasure-request");
const { processAccountErasureBatch } =
  await import("../src/lib/account-erasure-cleanup");
const { claimMail, settleMail } = await import("../src/lib/mail-outbox");
const auth = await getAuth();
const adb = new Database(path.join(root, "auth/auth.sqlite"));
const sdb = new Database(path.join(root, "data/studio.sqlite"));
const workers: ChildProcess[] = [];
after(async () => {
  await shutdownTestProcesses(workers);
  adb.close();
  sdb.close();
  await rm(root, { recursive: true, force: true });
});
async function waitFor(
  check: () => boolean | Promise<boolean>,
  message: string,
  timeout = 60000,
) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(message);
}
async function account(email: string) {
  const signup = await auth.api.signUpEmail({
    body: { email, password, name: "Native cleanup maker" },
  });
  adb.prepare("UPDATE user SET emailVerified=1 WHERE id=?").run(signup.user.id);
  const login = await auth.api.signInEmail({
    body: { email, password },
    asResponse: true,
  });
  return {
    id: signup.user.id,
    workspace: app.ensureWorkspace(signup.user.id, "Maker").id,
    headers: new Headers({
      origin,
      [ACCOUNT_HEADER]: signup.user.id,
      cookie: login.headers
        .getSetCookie()
        .map((value) => value.split(";")[0])
        .join("; "),
    }),
  };
}
async function film(workspace: string, color: string) {
  const brief = {
    prompt: "Synthetic publishable film",
    duration: 5,
    format: "landscape" as const,
  };
  const p = app.createProject(brief, workspace);
  const asset = await storeImage(
    await sharp({
      create: { width: 64, height: 64, channels: 3, background: color },
    })
      .png()
      .toBuffer(),
    "Private original.png",
    "Generated test fixture",
  );
  app.appendOwnedAsset(p.id, workspace, asset);
  const timeline = blankTimeline(brief);
  timeline.scenes[0].layers[0] = {
    ...timeline.scenes[0].layers[0],
    kind: "image",
    assetId: asset.id,
  };
  const edited = app.reviseProject(
    app.getProject(p.id)!,
    timeline,
    "Original fixture",
  );
  return { project: edited, asset };
}
async function hash(file: string) {
  return createHash("sha256")
    .update(await readFile(file))
    .digest("hex");
}
async function render(project: Parameters<typeof app.createJob>[0]) {
  const job = app.createJob(project);
  await waitFor(() => {
    const current = app.getJob(job.id)!;
    if (current.status === "failed")
      throw new Error(current.error || "Synthetic export failed.");
    return current.status === "completed";
  }, "Synthetic MP4 did not finish.");
  return { id: job.id, file: path.join(app.artifactDir, job.id, "video.mp4") };
}
test(
  "private account cleanup waits for real render-file cleanup and captured mail before credentials/journal completion, preserving another studio and shared spending",
  { timeout: 120000 },
  async () => {
    const a = await account("native-erasure-A@example.test");
    const captured = claimMail();
    assert(captured);
    assert.equal(captured.mail.accountId, a.id);
    const b = await account("native-erasure-B@example.test");
    const af = await film(a.workspace, "#cf3658"),
      bf = await film(b.workspace, "#18a68a");
    const env: NodeJS.ProcessEnv = { ...process.env, NODE_ENV: "production" };
    for (const key of Object.keys(env))
      if (
        key.startsWith("REELCHEMY_PRIVACY_") ||
        [
          "BETTER_AUTH_SECRET",
          "REELCHEMY_AUTH_DIR",
          "AI_API_KEY",
          "SMTP_HOST",
          "SMTP_USER",
          "SMTP_PASSWORD",
          "EMAIL_FROM",
        ].includes(key)
      )
        delete env[key];
    const worker = spawnTestProcess(
      process.execPath,
      ["--import", "tsx", "scripts/worker-entrypoint.ts"],
      { env, stdio: ["ignore", "ignore", "pipe"] },
    );
    workers.push(worker);
    let errors = "";
    worker.stderr?.on("data", (data) => {
      errors = (errors + String(data)).slice(-4000);
    });
    await waitFor(async () => {
      if (worker.exitCode !== null)
        throw new Error(errors || "Native worker exited.");
      try {
        return recentHeartbeat(
          JSON.parse(
            await readFile(path.join(app.dataDir, HEARTBEAT_NAME), "utf8"),
          ),
        );
      } catch {
        return false;
      }
    }, "Native cleanup worker not ready.");
    const ar = await render(af.project),
      br = await render(bf.project);
    assert((await stat(ar.file)).size > 1000);
    assert((await stat(br.file)).size > 1000);
    const bSource = path.join(app.dataDir, "assets", bf.asset.id),
      bSourceHash = await hash(bSource),
      bExportHash = await hash(br.file);
    const policy = providerBudgetPolicy({
      REELCHEMY_AI_INPUT_USD_PER_MILLION: "1",
      REELCHEMY_AI_OUTPUT_USD_PER_MILLION: "2",
    });
    const usage = app.providerUsage.reserve(
      a.workspace,
      {
        provider: "compatible",
        model: "synthetic-offline",
        payloadBytes: 1000,
      },
      policy,
    );
    app.providerUsage.uncertain(usage);
    const beforeBudget = providerUsageSummary(sdb).totals;
    const value = {
      requestId: randomUUID(),
      receipt: createErasureReceipt(),
      password,
      confirmation: "DELETE MY ACCOUNT",
    };
    await confirmAccountErasure(value, a.headers);
    const context = await accountAuthContext();
    const first = processAccountErasureBatch(context.database, vault);
    assert.equal(first.scheduled, 1);
    assert.equal(first.completed, 0);
    assert.equal(first.waiting, 1);
    await waitFor(
      () =>
        app.ownedProjectDeletion(af.project.id, a.workspace)?.state ===
        "completed",
      "Native project cleanup did not complete.",
    );
    await assert.rejects(() =>
      access(path.join(app.dataDir, "assets", af.asset.id)),
    );
    await assert.rejects(() => access(path.join(app.artifactDir, ar.id)));
    const held = processAccountErasureBatch(context.database, vault);
    assert.equal(held.completed, 0);
    assert.equal(held.waiting, 1);
    assert(
      adb.prepare("SELECT 1 FROM user WHERE id=?").get(a.id),
      "credentials remain while the captured mail lease is outstanding",
    );
    assert.equal(
      erasureStatusByReceipt(vault, value.requestId, value.receipt)?.state,
      "cleaning",
    );
    assert(
      settleMail(captured, false),
      "fake send teardown acknowledges its captured lease; no real SMTP was used",
    );
    const final = processAccountErasureBatch(context.database, vault);
    assert.equal(final.completed, 1);
    assert.equal(final.blocked, 0);
    assert.equal(
      erasureStatusByReceipt(vault, value.requestId, value.receipt)?.state,
      "completed",
    );
    assert.equal(
      adb.prepare("SELECT 1 FROM user WHERE id=?").get(a.id),
      undefined,
    );
    assert.equal(
      adb.prepare("SELECT 1 FROM account WHERE userId=?").get(a.id),
      undefined,
    );
    assert.equal(
      sdb.prepare("SELECT 1 FROM workspaces WHERE id=?").get(a.workspace),
      undefined,
    );
    assert.deepEqual(providerUsageSummary(sdb).totals, beforeBudget);
    assert.equal(await hash(bSource), bSourceHash);
    assert.equal(await hash(br.file), bExportHash);
    assert.equal(
      (await auth.api.getSession({ headers: b.headers }))?.user.id,
      b.id,
    );
    assert.equal(
      processAccountErasureBatch(context.database, vault).completed,
      0,
    );
    const next = await render(app.getProject(bf.project.id)!);
    assert((await stat(next.file)).size > 1000);
    console.log(
      JSON.stringify({
        event: "account.erasure.native.accepted",
        otherSourceSha256: bSourceHash,
        otherExportSha256: bExportHash,
        freshExportBytes: (await stat(next.file)).size,
        sourceAndExportRemoved: true,
        capturedMailAcknowledgedBeforeCredentials: true,
        sharedSpendingPreserved: true,
      }),
    );
    await shutdownTestProcesses([worker]);
  },
);
