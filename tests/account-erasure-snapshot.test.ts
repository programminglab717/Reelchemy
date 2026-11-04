import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, readFile } from "node:fs/promises";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import path from "node:path";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";
import {
  initializePrivacyVault,
  recordErasureApproval,
  advanceErasureState,
} from "../src/lib/privacy-vault";
import { createErasureReceipt } from "../src/lib/account-erasure-approval";
import { reconcileErasureSnapshot } from "../src/lib/account-erasure-snapshot";
import { blankTimeline } from "../src/lib/editor";
import { providerBudgetPolicy } from "../src/lib/provider-budget-policy";
const root = await mkdtemp(path.join(tmpdir(), "reelchemy-erasure-snapshot-")),
  vault = initializePrivacyVault(path.join(root, "privacy"));
Object.assign(process.env, {
  NODE_ENV: "test",
  REELCHEMY_DATA_DIR: path.join(root, "source/data"),
  REELCHEMY_AUTH_DIR: path.join(root, "source/auth"),
  REELCHEMY_ARTIFACT_DIR: path.join(root, "source/artifacts"),
  REELCHEMY_PRIVACY_DIR: vault.directory,
  REELCHEMY_PRIVACY_ID: vault.id,
  REELCHEMY_PRIVACY_KEY_FINGERPRINT: vault.keyFingerprint,
  BETTER_AUTH_URL: "http://127.0.0.1:3001",
  BETTER_AUTH_SECRET: randomBytes(48).toString("base64url"),
  EMAIL_DELIVERY: "file",
});
const app = await import("../src/lib/db"),
  { getAuth } = await import("../src/lib/auth"),
  auth = await getAuth();
const sourceStudio = new Database(path.join(root, "source/data/studio.sqlite")),
  sourceAuth = new Database(path.join(root, "source/auth/auth.sqlite"));
after(async () => {
  sourceStudio.close();
  sourceAuth.close();
  await rm(root, { recursive: true, force: true });
});
const policy = providerBudgetPolicy({
  REELCHEMY_AI_INPUT_USD_PER_MILLION: "1",
  REELCHEMY_AI_OUTPUT_USD_PER_MILLION: "2",
});
async function identity(label: string) {
  const signup = await auth.api.signUpEmail({
    body: {
      email: `${label}@example.test`,
      password: "Synthetic-snapshot-passphrase-4826",
      name: label,
    },
  });
  const workspace = app.ensureWorkspace(signup.user.id, label);
  const brief = {
    prompt: `Private ${label} film`,
    duration: 5,
    format: "landscape" as const,
  };
  const project = app.createProject(brief, workspace.id);
  app.reviseProject(project, blankTimeline(brief), "Original saved edit");
  const job = app.createJob(app.getProject(project.id)!);
  return {
    id: signup.user.id,
    workspace: workspace.id,
    project: project.id,
    job: job.id,
  };
}
async function copy(label: string) {
  const directory = path.join(root, label);
  await mkdir(directory);
  const studioFile = path.join(directory, "studio.sqlite"),
    authFile = path.join(directory, "auth.sqlite");
  await sourceStudio.backup(studioFile);
  await sourceAuth.backup(authFile);
  const studio = new Database(studioFile),
    accounts = new Database(authFile);
  studio.pragma("journal_mode=DELETE");
  accounts.pragma("journal_mode=DELETE");
  return {
    studio,
    accounts,
    studioFile,
    authFile,
    close() {
      studio.close();
      accounts.close();
    },
  };
}
async function fingerprints() {
  const files = [
    "source/data/studio.sqlite",
    "source/data/studio.sqlite-wal",
    "source/auth/auth.sqlite",
    "source/auth/auth.sqlite-wal",
    "privacy/journal.sqlite",
  ];
  return Promise.all(
    files.map(async (file) => {
      try {
        return [
          file,
          createHash("sha256")
            .update(await readFile(path.join(root, file)))
            .digest("hex"),
        ];
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT")
          return [file, null];
        throw error;
      }
    }),
  );
}
test("an older inactive copy honors a newly completed private approval while preserving source bytes, other users and all global provider charges", async () => {
  const a = await identity("snapshot-erased"),
    b = await identity("snapshot-kept");
  const usage = app.providerUsage.reserve(
    a.workspace,
    { provider: "compatible", model: "synthetic-offline", payloadBytes: 1000 },
    policy,
  );
  const cloned = await copy("older-copy");
  const input = {
    ownerId: a.id,
    workspaceId: a.workspace,
    requestId: randomUUID(),
    receipt: createErasureReceipt(),
  };
  recordErasureApproval(vault, input);
  advanceErasureState(vault, input.requestId, "requested", "cleaning");
  advanceErasureState(vault, input.requestId, "cleaning", "completed");
  const original = await fingerprints();
  const keptProject = cloned.studio
      .prepare("SELECT * FROM projects WHERE id=?")
      .get(b.project),
    keptUser = cloned.accounts
      .prepare("SELECT * FROM user WHERE id=?")
      .get(b.id);
  const charge = cloned.studio
    .prepare("SELECT * FROM provider_usage WHERE id=?")
    .get(usage) as Record<string, unknown>;
  try {
    assert.deepEqual(
      reconcileErasureSnapshot(cloned.studio, cloned.accounts, vault),
      { omittedAccounts: 1 },
    );
    assert.equal(
      cloned.studio.prepare("SELECT 1 FROM projects WHERE id=?").get(a.project),
      undefined,
    );
    assert.equal(
      cloned.studio.prepare("SELECT 1 FROM jobs WHERE id=?").get(a.job),
      undefined,
    );
    assert.equal(
      cloned.studio
        .prepare("SELECT 1 FROM workspaces WHERE id=?")
        .get(a.workspace),
      undefined,
    );
    assert.equal(
      cloned.accounts.prepare("SELECT 1 FROM user WHERE id=?").get(a.id),
      undefined,
    );
    assert.equal(
      cloned.accounts.prepare("SELECT 1 FROM account WHERE userId=?").get(a.id),
      undefined,
    );
    assert.deepEqual(
      cloned.studio.prepare("SELECT * FROM projects WHERE id=?").get(b.project),
      keptProject,
    );
    assert.deepEqual(
      cloned.accounts.prepare("SELECT * FROM user WHERE id=?").get(b.id),
      keptUser,
    );
    const after = cloned.studio
      .prepare("SELECT * FROM provider_usage WHERE id=?")
      .get(usage) as Record<string, unknown>;
    assert.notEqual(after.workspace_id, a.workspace);
    assert.equal(after.state, "uncertain");
    for (const key of Object.keys(charge))
      if (!["workspace_id", "state", "finished_at"].includes(key))
        assert.deepEqual(after[key], charge[key], key);
    assert.throws(
      () =>
        cloned.accounts
          .prepare(
            "INSERT INTO user(id,name,email,emailVerified,createdAt,updatedAt) VALUES(?,?,?,0,?,?)",
          )
          .run(
            a.id,
            "Restored identity",
            "another@example.test",
            Date.now(),
            Date.now(),
          ),
      /Account deletion/,
    );
    assert.deepEqual(
      reconcileErasureSnapshot(cloned.studio, cloned.accounts, vault),
      { omittedAccounts: 0 },
    );
    assert.deepEqual(await fingerprints(), original);
  } finally {
    cloned.close();
  }
});
test("a copied account cannot substitute an empty authority or erase a workspace reassigned to another owner", async () => {
  const a = await identity("snapshot-conflict"),
    cloned = await copy("conflicting-copy");
  const input = {
    ownerId: a.id,
    workspaceId: a.workspace,
    requestId: randomUUID(),
    receipt: createErasureReceipt(),
  };
  recordErasureApproval(vault, input);
  const other = initializePrivacyVault(path.join(root, "other-authority"));
  try {
    const before = cloned.studio
      .prepare("SELECT * FROM projects ORDER BY id")
      .all();
    assert.throws(() =>
      reconcileErasureSnapshot(cloned.studio, cloned.accounts, other),
    );
    assert.deepEqual(
      cloned.studio.prepare("SELECT * FROM projects ORDER BY id").all(),
      before,
    );
    cloned.studio
      .prepare("UPDATE workspaces SET owner_id=? WHERE id=?")
      .run("foreign-copy-owner", a.workspace);
    assert.throws(() =>
      reconcileErasureSnapshot(cloned.studio, cloned.accounts, vault),
    );
    assert.deepEqual(
      cloned.studio.prepare("SELECT * FROM projects ORDER BY id").all(),
      before,
    );
    assert(cloned.accounts.prepare("SELECT 1 FROM user WHERE id=?").get(a.id));
  } finally {
    cloned.close();
  }
});
