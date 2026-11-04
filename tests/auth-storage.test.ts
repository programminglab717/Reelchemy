import { test, after } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  writeFile,
  rm,
  symlink,
  stat,
  readdir,
  access,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { authStorageDirectory } from "../src/lib/auth-storage";
import { createBackup, restoreBackup } from "../src/lib/backup";
import { blankTimeline } from "../src/lib/editor";
import Database from "better-sqlite3";
const dir = await mkdtemp(path.join(tmpdir(), "reelchemy-auth-storage-"));
after(() => rm(dir, { recursive: true, force: true }));
test("production requires disjoint canonical authentication storage and refuses legacy credential leftovers", async () => {
  const data = path.join(dir, "policy-data"),
    auth = path.join(dir, "policy-auth"),
    artifacts = path.join(dir, "policy-exports");
  await mkdir(data);
  await mkdir(auth);
  await mkdir(artifacts);
  const env = {
    NODE_ENV: "production",
    REELCHEMY_DATA_DIR: data,
    REELCHEMY_ARTIFACT_DIR: artifacts,
    REELCHEMY_AUTH_DIR: auth,
  };
  assert.equal(
    authStorageDirectory({ REELCHEMY_DATA_DIR: data }),
    data,
    "development legacy state remains available",
  );
  assert.throws(
    () => authStorageDirectory({ ...env, REELCHEMY_AUTH_DIR: undefined }),
    /requires a separate/,
  );
  assert.equal(authStorageDirectory(env), auth);
  for (const root of [
    data,
    path.join(data, "private-auth"),
    artifacts,
    path.join(artifacts, "accounts"),
    dir,
  ])
    assert.throws(
      () => authStorageDirectory({ ...env, REELCHEMY_AUTH_DIR: root }),
      /must be separate/,
    );
  const link = path.join(dir, "linked-auth");
  await symlink(data, link);
  assert.throws(
    () => authStorageDirectory({ ...env, REELCHEMY_AUTH_DIR: link }),
    /must be separate/,
  );
  for (const file of [
    "auth.sqlite",
    "auth.sqlite-wal",
    "auth.sqlite-shm",
    "auth-secret",
    "mail",
  ]) {
    await writeFile(path.join(data, file), "legacy synthetic fixture");
    assert.throws(
      () => authStorageDirectory(env),
      /Legacy authentication files/,
    );
    await rm(path.join(data, file));
  }
  assert.equal(authStorageDirectory(env), auth);
});
test("production accounts/private queued mail and snapshots use separate storage; restore splits legacy layout and revokes only restored sessions", async () => {
  const saved = { ...process.env };
  const data = path.join(dir, "studio"),
    authDirectory = path.join(dir, "accounts"),
    artifacts = path.join(dir, "exports");
  Object.assign(process.env, { NODE_ENV: "production" });
  process.env.REELCHEMY_DATA_DIR = data;
  process.env.REELCHEMY_AUTH_DIR = authDirectory;
  process.env.REELCHEMY_ARTIFACT_DIR = artifacts;
  process.env.BETTER_AUTH_URL = "https://127.0.0.1:3001";
  process.env.BETTER_AUTH_SECRET = randomBytes(48).toString("base64url");
  process.env.EMAIL_DELIVERY = "smtp";
  process.env.SMTP_HOST = "127.0.0.1";
  process.env.EMAIL_FROM = "studio@example.test";
  try {
    const db = await import("../src/lib/db");
    const { getAuth, migrateAuth } = await import("../src/lib/auth");
    await migrateAuth();
    const auth = await getAuth();
    const email = "separate-accounts@example.test",
      password = "Synthetic-separated-passphrase-4826";
    const signup = await auth.api.signUpEmail({
      body: { name: "Separate account", email, password },
    });
    const file = path.join(authDirectory, "auth.sqlite");
    assert.equal((await stat(authDirectory)).mode & 0o777, 0o700);
    assert.equal((await stat(file)).mode & 0o777, 0o600);
    await assert.rejects(() => access(path.join(data, "auth.sqlite")));
    await assert.rejects(() => access(path.join(data, "mail")));
    const { mailDir } = await import("../src/lib/mail");
    assert.equal(mailDir(), path.join(authDirectory, "mail"));
    const mail = (await readdir(mailDir())).filter((name) =>
      name.endsWith(".json"),
    );
    assert.equal(
      mail.length,
      1,
      "mail is queued privately without a delivery worker",
    );
    assert.equal(
      (await stat(path.join(mailDir(), mail[0]))).mode & 0o777,
      0o600,
    );
    const admin = new Database(file);
    admin
      .prepare('UPDATE "user" SET emailVerified=1 WHERE id=?')
      .run(signup.user.id);
    admin.close();
    const login = await auth.api.signInEmail({
      body: { email, password },
      asResponse: true,
    });
    assert.equal(login.status, 200);
    assert(
      login.headers.getSetCookie().some((value) => /; Secure/i.test(value)),
    );
    const cookie = login.headers
      .getSetCookie()
      .map((value) => value.split(";")[0])
      .join("; ");
    const workspace = db.ensureWorkspace(signup.user.id, "Owner");
    const p = db.createProject(
      {
        prompt: "Separated account snapshot",
        duration: 5,
        format: "landscape",
      },
      workspace.id,
    );
    db.reviseProject(p, blankTimeline(p.brief), "Initial");
    const sourceMailbox = await readdir(mailDir());
    const sourceMailBytes = await Promise.all(
      sourceMailbox.map((name) => readFile(path.join(mailDir(), name))),
    );
    const snapshot = path.join(dir, "snapshot");
    await createBackup({
      data,
      auth: authDirectory,
      artifacts,
      output: snapshot,
    });
    await assert.rejects(
      () =>
        createBackup({
          data,
          auth: authDirectory,
          artifacts,
          output: path.join(authDirectory, "bad-snapshot"),
        }),
      /outside/,
    );
    const restored = await restoreBackup(snapshot, path.join(dir, "restored"));
    assert.equal(restored.auth, path.join(dir, "restored/auth"));
    assert.throws(
      () =>
        authStorageDirectory({
          NODE_ENV: "development",
          REELCHEMY_DATA_DIR: restored.data,
          REELCHEMY_ARTIFACT_DIR: restored.artifacts,
        }),
      /Restored authentication requires/,
    );
    await assert.rejects(() => access(path.join(restored.data, "auth.sqlite")));
    await assert.rejects(() => access(path.join(restored.auth, "mail")));
    const target = new Database(path.join(restored.auth, "auth.sqlite"));
    assert.equal(
      (
        target.prepare('SELECT count(*) n FROM "session"').get() as {
          n: number;
        }
      ).n,
      0,
    );
    assert.equal(
      (target.prepare('SELECT count(*) n FROM "user"').get() as { n: number })
        .n,
      1,
    );
    target.close();
    const source = new Database(file);
    assert(
      (
        source.prepare('SELECT count(*) n FROM "session"').get() as {
          n: number;
        }
      ).n > 0,
    );
    source.close();
    assert(
      (await auth.api.getSession({ headers: new Headers({ cookie }) }))?.user,
    );
    assert.deepEqual(
      await readdir(mailDir()),
      sourceMailbox,
      "snapshot/restore must not consume the source outbox or its coordination database",
    );
    assert.deepEqual(
      await Promise.all(
        sourceMailbox.map((name) => readFile(path.join(mailDir(), name))),
      ),
      sourceMailBytes,
      "Snapshot/restore preserves every original private message and coordination byte.",
    );
    assert.equal(
      authStorageDirectory({
        ...process.env,
        REELCHEMY_DATA_DIR: restored.data,
        REELCHEMY_AUTH_DIR: restored.auth,
        REELCHEMY_ARTIFACT_DIR: restored.artifacts,
      }),
      restored.auth,
    );
  } finally {
    for (const key of Object.keys(process.env))
      if (!(key in saved)) delete process.env[key];
    Object.assign(process.env, saved);
  }
});
