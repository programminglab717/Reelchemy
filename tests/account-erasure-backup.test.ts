import { test, after } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  cp,
  rm,
  readFile,
  writeFile,
  rename,
  access,
  stat,
} from "node:fs/promises";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import sharp from "sharp";
import { execFileSync } from "node:child_process";
import {
  initializePrivacyVault,
  recordErasureApproval,
  advanceErasureState,
} from "../src/lib/privacy-vault";
import { createErasureReceipt } from "../src/lib/account-erasure-approval";
import { createBackup, verifyBackup, restoreBackup } from "../src/lib/backup";
import { blankTimeline } from "../src/lib/editor";
const root = await mkdtemp(path.join(tmpdir(), "reelchemy-account-backup-v5-")),
  vault = initializePrivacyVault(path.join(root, "privacy"));
Object.assign(process.env, {
  NODE_ENV: "test",
  REELCHEMY_DATA_DIR: path.join(root, "live/data"),
  REELCHEMY_AUTH_DIR: path.join(root, "live/auth"),
  REELCHEMY_ARTIFACT_DIR: path.join(root, "live/artifacts"),
  REELCHEMY_PRIVACY_DIR: vault.directory,
  REELCHEMY_PRIVACY_ID: vault.id,
  REELCHEMY_PRIVACY_KEY_FINGERPRINT: vault.keyFingerprint,
  BETTER_AUTH_URL: "http://127.0.0.1:3001",
  BETTER_AUTH_SECRET: randomBytes(48).toString("base64url"),
  EMAIL_DELIVERY: "file",
});
const app = await import("../src/lib/db"),
  { getAuth } = await import("../src/lib/auth"),
  auth = await getAuth(),
  { storeImage } = await import("../src/lib/assets");
after(() => rm(root, { recursive: true, force: true }));
async function hash(file: string) {
  return createHash("sha256")
    .update(await readFile(file))
    .digest("hex");
}
async function fixture(label: string) {
  const signup = await auth.api.signUpEmail({
      body: {
        email: `${label}@example.test`,
        password: "Synthetic-backup-erasure-passphrase-4826",
        name: label,
      },
    }),
    workspace = app.ensureWorkspace(signup.user.id, label);
  const account = new Database(
    path.join(process.env.REELCHEMY_AUTH_DIR!, "auth.sqlite"),
  );
  account
    .prepare("UPDATE user SET emailVerified=1 WHERE id=?")
    .run(signup.user.id);
  account.close();
  const brief = {
      prompt: `Synthetic ${label} film`,
      duration: 5,
      format: "landscape" as const,
    },
    project = app.createProject(brief, workspace.id);
  const image = await storeImage(
    await sharp({
      create: { width: 16, height: 16, channels: 3, background: "#18a68a" },
    })
      .png()
      .toBuffer(),
    "Original.png",
    "Generated test fixture",
  );
  app.appendOwnedAsset(project.id, workspace.id, image);
  const edited = app.reviseProject(
    app.getProject(project.id)!,
    blankTimeline(brief),
    "Saved source",
  );
  const job = app.createJob(edited),
    directory = path.join(app.artifactDir, job.id);
  await mkdir(directory, { recursive: true });
  await writeFile(
    path.join(directory, "video.mp4"),
    `Opaque synthetic backup fixture ${label}`,
  );
  app.updateJob(job.id, { status: "completed", progress: 1 });
  return {
    ownerId: signup.user.id,
    workspaceId: workspace.id,
    projectId: project.id,
    assetId: image.id,
    jobId: job.id,
  };
}
async function sourceProof() {
  const files = [
    "live/data/studio.sqlite",
    "live/data/studio.sqlite-wal",
    "live/auth/auth.sqlite",
    "live/auth/auth.sqlite-wal",
    "privacy/journal.sqlite",
  ];
  return Promise.all(
    files.map(async (file) => {
      try {
        return [file, await hash(path.join(root, file))];
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT")
          return [file, null];
        throw error;
      }
    }),
  );
}
const backupOptions = {
  data: process.env.REELCHEMY_DATA_DIR!,
  auth: process.env.REELCHEMY_AUTH_DIR!,
  artifacts: process.env.REELCHEMY_ARTIFACT_DIR!,
  vault,
};
test("current authority removes a later-deleted identity from old and new snapshots without changing original backups, sources or another maker's files", async () => {
  const a = await fixture("backup-erased"),
    b = await fixture("backup-kept"),
    old = path.join(root, "older-snapshot"),
    staleDirectory = path.join(root, "stale-authority");
  await cp(vault.directory, staleDirectory, { recursive: true });
  await createBackup({ ...backupOptions, output: old });
  const originalManifest = await readFile(path.join(old, "manifest.json")),
    manifest = await verifyBackup(old);
  assert.equal(manifest.version, 5);
  assert(manifest.capabilities?.includes("account-erasure-v1"));
  assert.equal(manifest.privacy?.sequence, 0);
  assert(
    !manifest.entries.some((entry) =>
      /approval\.key|journal\.sqlite|privacy|mail|heartbeat|lifecycle/.test(
        entry.path,
      ),
    ),
  );
  const request = {
    ownerId: a.ownerId,
    workspaceId: a.workspaceId,
    requestId: randomUUID(),
    receipt: createErasureReceipt(),
  };
  recordErasureApproval(vault, request);
  advanceErasureState(vault, request.requestId, "requested", "cleaning");
  advanceErasureState(vault, request.requestId, "cleaning", "completed");
  const sourceBefore = await sourceProof();
  const restored = await restoreBackup(old, path.join(root, "restored-old"), {
    vault,
  });
  const studio = new Database(path.join(restored.data, "studio.sqlite")),
    accounts = new Database(path.join(restored.auth, "auth.sqlite"));
  try {
    assert.equal(
      studio.prepare("SELECT 1 FROM projects WHERE id=?").get(a.projectId),
      undefined,
    );
    assert(
      studio.prepare("SELECT 1 FROM projects WHERE id=?").get(b.projectId),
    );
    assert.equal(
      accounts.prepare("SELECT 1 FROM user WHERE id=?").get(a.ownerId),
      undefined,
    );
    assert(accounts.prepare("SELECT 1 FROM user WHERE id=?").get(b.ownerId));
  } finally {
    studio.close();
    accounts.close();
  }
  const restoredAuthBytes = await readFile(
    path.join(restored.auth, "auth.sqlite"),
  );
  assert(
    !restoredAuthBytes.includes(Buffer.from("backup-erased@example.test")),
    "reconciled inactive authentication copies must not retain an erased email in free pages",
  );
  assert(restoredAuthBytes.includes(Buffer.from("backup-kept@example.test")));
  assert(
    !(await readFile(path.join(restored.data, "studio.sqlite"))).includes(
      Buffer.from("Synthetic backup-erased film"),
    ),
    "removed private directions must not survive in copied free pages",
  );
  await assert.rejects(() =>
    access(path.join(restored.data, "assets", a.assetId)),
  );
  await assert.rejects(() => access(path.join(restored.artifacts, a.jobId)));
  assert.equal(
    await hash(path.join(restored.data, "assets", b.assetId)),
    await hash(path.join(app.dataDir, "assets", b.assetId)),
  );
  assert.equal(
    await hash(path.join(restored.artifacts, b.jobId, "video.mp4")),
    await hash(path.join(app.artifactDir, b.jobId, "video.mp4")),
  );
  await assert.rejects(() =>
    access(path.join(root, "restored-old/RESTORE_PENDING.json")),
  );
  const receipt = JSON.parse(
    await readFile(path.join(root, "restored-old/RESTORE.json"), "utf8"),
  );
  assert.equal(receipt.approvedAccountsOmitted, 1);
  assert.equal(receipt.privacy.sequence, 1);
  const probe = path.join(root, "restored-login.mjs");
  await writeFile(
    probe,
    `import {readFileSync} from 'node:fs';
const input=JSON.parse(readFileSync(0,'utf8'));
const {getAuth}=await import(${JSON.stringify(path.resolve("src/lib/auth.ts"))});
const auth=await getAuth();
const kept=await auth.api.signInEmail({body:{email:input.kept,password:input.password},asResponse:true});
const erased=await auth.api.signInEmail({body:{email:input.erased,password:input.password},asResponse:true});
process.stdout.write(JSON.stringify({kept:kept.status,erased:erased.status}));`,
    { mode: 0o600 },
  );
  const probeResult = execFileSync(
    process.execPath,
    ["--import", "tsx", probe],
    {
      env: {
        ...process.env,
        REELCHEMY_DATA_DIR: restored.data,
        REELCHEMY_AUTH_DIR: restored.auth,
        REELCHEMY_ARTIFACT_DIR: restored.artifacts,
      },
      input: JSON.stringify({
        kept: "backup-kept@example.test",
        erased: "backup-erased@example.test",
        password: "Synthetic-backup-erasure-passphrase-4826",
      }),
      encoding: "utf8",
      timeout: 15000,
      stdio: ["pipe", "pipe", "pipe"],
    },
  );
  assert.deepEqual(JSON.parse(probeResult), { kept: 200, erased: 401 });
  const fresh = path.join(root, "fresh-snapshot");
  await createBackup({ ...backupOptions, output: fresh });
  const freshManifest = await verifyBackup(fresh);
  assert.equal(freshManifest.privacy?.sequence, 1);
  assert(
    !(await readFile(path.join(fresh, "data/auth.sqlite"))).includes(
      Buffer.from("backup-erased@example.test"),
    ),
  );
  assert(
    !(await readFile(path.join(fresh, "data/studio.sqlite"))).includes(
      Buffer.from("Synthetic backup-erased film"),
    ),
  );
  assert(
    !freshManifest.entries.some(
      (entry) =>
        entry.path === `data/assets/${a.assetId}` ||
        entry.path.startsWith(`artifacts/${a.jobId}/`),
    ),
  );
  assert(
    freshManifest.entries.some(
      (entry) => entry.path === `data/assets/${b.assetId}`,
    ),
  );
  assert.deepEqual(await sourceProof(), sourceBefore);
  assert.deepEqual(
    await readFile(path.join(old, "manifest.json")),
    originalManifest,
  );
  await assert.rejects(() =>
    restoreBackup(fresh, path.join(root, "refuse-stale"), {
      vault: { ...vault, directory: staleDirectory },
    }),
  );
  await assert.rejects(() => access(path.join(root, "refuse-stale")));
  const other = initializePrivacyVault(path.join(root, "different-authority"));
  await assert.rejects(() =>
    restoreBackup(old, path.join(root, "refuse-foreign"), { vault: other }),
  );
  await assert.rejects(() => access(path.join(root, "refuse-foreign")));
  const marker = path.join(vault.directory, "vault.json");
  await rename(marker, marker + ".held");
  try {
    await assert.rejects(() =>
      restoreBackup(old, path.join(root, "refuse-missing"), { vault }),
    );
    await assert.rejects(() => access(path.join(root, "refuse-missing")));
  } finally {
    await rename(marker + ".held", marker);
  }
  // Simulate an honest older-format snapshot without any new privacy metadata.
  // Only this newly copied fixture is edited/rehash; the original remains exact.
  const legacy = path.join(root, "legacy-v4");
  await cp(old, legacy, { recursive: true });
  for (const [file, prefix, table] of [
    ["data/studio.sqlite", "erasing_", "account_erasures"],
    ["data/auth.sqlite", "auth_erasure_", "auth_erasure_protocol"],
  ] as const) {
    const db = new Database(path.join(legacy, file));
    for (const row of db
      .prepare("SELECT name FROM sqlite_master WHERE type='trigger'")
      .all() as { name: string }[])
      if (
        row.name.startsWith(prefix) ||
        row.name.startsWith("erasure_barrier_")
      )
        db.exec(`DROP TRIGGER ${row.name}`);
    if (file.includes("auth.sqlite"))
      db.exec("DROP TABLE auth_erasure_approvals");
    db.exec(`DROP TABLE ${table}`);
    db.exec("VACUUM");
    db.close();
  }
  const older = {
    ...manifest,
    version: 4,
    privacy: undefined,
    capabilities: manifest.capabilities?.filter(
      (cap) => cap !== "account-erasure-v1",
    ),
    entries: await Promise.all(
      manifest.entries.map(async (entry) => ({
        ...entry,
        bytes: (await stat(path.join(legacy, entry.path))).size,
        sha256: await hash(path.join(legacy, entry.path)),
      })),
    ),
  };
  await writeFile(path.join(legacy, "manifest.json"), JSON.stringify(older));
  await verifyBackup(legacy);
  const fromLegacy = await restoreBackup(
    legacy,
    path.join(root, "restored-legacy"),
    { vault },
  );
  const legacyAuth = new Database(path.join(fromLegacy.auth, "auth.sqlite"));
  try {
    assert.equal(
      legacyAuth.prepare("SELECT 1 FROM user WHERE id=?").get(a.ownerId),
      undefined,
    );
    assert(legacyAuth.prepare("SELECT 1 FROM user WHERE id=?").get(b.ownerId));
  } finally {
    legacyAuth.close();
  }
  assert.deepEqual(await sourceProof(), sourceBefore);
  const saved = await readFile(path.join(fresh, "manifest.json"));
  await writeFile(
    path.join(fresh, "manifest.json"),
    JSON.stringify({ ...freshManifest, privacy: undefined }),
  );
  await assert.rejects(() => verifyBackup(fresh), /privacy|capability/);
  await writeFile(path.join(fresh, "manifest.json"), saved);
});
