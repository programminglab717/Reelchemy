import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  readdir,
  rm,
  chmod,
  symlink,
  link,
} from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { randomUUID, createHash } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import Database from "better-sqlite3";
import { initializePrivacyVault } from "../src/lib/privacy-vault";
import { createBackup, verifyBackup } from "../src/lib/backup";
import { blankTimeline } from "../src/lib/editor";
import {
  inspectEncryptedBackups,
  uploadEncryptedBackup,
  verifyEncryptedBackup,
  expireEncryptedBackups,
  EncryptedBackupUnavailable,
  type EncryptedBackupOptions,
} from "../src/lib/encrypted-backup";

const binary = process.env.REELCHEMY_RESTIC_BINARY || "/usr/bin/restic";
async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "reelchemy-encrypted-test-")),
    repository = path.join(root, "repository"),
    passwordFile = path.join(root, "password");
  await writeFile(passwordFile, "synthetic-repository-passphrase-72b714\n", {
    mode: 0o600,
  });
  const env: NodeJS.ProcessEnv = {
    NODE_ENV: "test",
    PATH: process.env.PATH || "/usr/bin:/bin",
    HOME: root,
    TMPDIR: root,
    RESTIC_REPOSITORY: repository,
    RESTIC_PASSWORD_FILE: passwordFile,
    TZ: "UTC",
    GOMAXPROCS: "2",
  };
  const run = (args: string[], cwd?: string) =>
    execFileSync(binary, ["--no-cache", "--json", ...args], {
      cwd,
      env,
      encoding: "utf8",
      timeout: 30000,
      maxBuffer: 12 * 1024 ** 2,
    });
  run(["init"]);
  const config = JSON.parse(run(["cat", "config"])),
    vault = initializePrivacyVault(path.join(root, "authority"));
  const options: EncryptedBackupOptions = {
    repository,
    passwordFile,
    repositoryId: config.id,
    authorityId: vault.id,
    authorityFingerprint: vault.keyFingerprint,
    binary,
    timeoutMs: 30000,
  };
  async function snapshot(
    name: string,
    marker = "Retained private maker",
    authority = vault,
  ) {
    const source = path.join(root, `source-${name}`),
      data = path.join(source, "data"),
      artifacts = path.join(source, "artifacts"),
      output = path.join(root, `snapshot-${name}`);
    await mkdir(data, { recursive: true, mode: 0o700 });
    await mkdir(artifacts, { mode: 0o700 });
    const db = new Database(path.join(data, "studio.sqlite"));
    db.exec(
      "CREATE TABLE projects(id TEXT PRIMARY KEY,data TEXT);CREATE TABLE jobs(id TEXT PRIMARY KEY,project_id TEXT,status TEXT,data TEXT,timeline TEXT);CREATE TABLE workspaces(owner_id TEXT);",
    );
    db.prepare("INSERT INTO projects VALUES(?,?)").run(
      randomUUID(),
      JSON.stringify({
        name: marker,
        timeline: blankTimeline({
          prompt: marker,
          duration: 5,
          format: "landscape",
        }),
        assets: [],
        revisions: [],
      }),
    );
    db.close();
    await createBackup({ data, artifacts, output, vault: authority });
    return output;
  }
  function tags(opts = options, hash?: string) {
    return [
      "reelchemy-backup-v1",
      `authority-${opts.authorityId}`,
      `key-${opts.authorityFingerprint}`,
      ...(hash ? [`manifest-${hash}`] : []),
    ];
  }
  async function historical(input: string, days: number, opts = options) {
    const hash = createHash("sha256")
      .update(await readFile(path.join(input, "manifest.json")))
      .digest("hex");
    const time = new Date(Date.now() - days * 86400000)
      .toISOString()
      .slice(0, 19)
      .replace("T", " ");
    const lines = run(
      [
        "backup",
        ".",
        "--host",
        `reelchemy-${opts.authorityId}`,
        "--time",
        time,
        ...tags(opts, hash).flatMap((tag) => ["--tag", tag]),
      ],
      input,
    )
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    return lines.find((line) => line.message_type === "summary")
      .snapshot_id as string;
  }
  return {
    root,
    options,
    env,
    run,
    vault,
    snapshot,
    historical,
    tags,
    close: () => rm(root, { recursive: true, force: true }),
  };
}
async function fingerprints(root: string) {
  const entries: Record<string, string> = {};
  async function walk(folder: string) {
    for (const item of await readdir(folder, { withFileTypes: true })) {
      const file = path.join(folder, item.name);
      if (item.isDirectory()) await walk(file);
      else
        entries[path.relative(root, file)] = createHash("sha256")
          .update(await readFile(file))
          .digest("hex");
    }
  }
  await walk(root);
  return entries;
}

test("real encrypted upload/restore and expiry cross source paths while preserving local originals, a retained maker and another authority", async () => {
  const f = await fixture();
  try {
    const marker = `synthetic-deleted-private-direction-${randomUUID()}`;
    for (const [index, days] of [60, 50, 40, 20].entries()) {
      const source = await f.snapshot(
        `old-${index}`,
        index === 0 ? marker : `Historical maker ${index}`,
      );
      await f.historical(source, days);
    }
    const current = await f.snapshot(
        "current",
        "Retained maker and original work",
      ),
      before = await fingerprints(current);
    const uploaded = await uploadEncryptedBackup(f.options, current);
    assert.match(uploaded.id, /^[a-f0-9]{64}$/);
    const verified = await verifyEncryptedBackup(f.options, uploaded.id);
    assert(verified.verified && verified.files > 0 && verified.bytes > 0);
    const other = initializePrivacyVault(path.join(f.root, "other-authority"));
    const otherOptions = {
      ...f.options,
      authorityId: other.id,
      authorityFingerprint: other.keyFingerprint,
    };
    const otherSource = await f.snapshot(
      "other",
      "Another maker's private work",
      other,
    );
    const otherUpload = await uploadEncryptedBackup(otherOptions, otherSource);
    const originalOther = await fingerprints(otherSource);
    const preview = await expireEncryptedBackups(f.options, {
      keepDays: 7,
      keepLast: 2,
    });
    assert.equal(preview.applied, false);
    assert.equal(preview.expireIds.length, 3);
    assert.equal(
      (await inspectEncryptedBackups(f.options)).snapshots.length,
      5,
    );
    const result = await expireEncryptedBackups(f.options, {
      keepDays: 7,
      keepLast: 2,
      apply: true,
    });
    assert(result.applied);
    assert.equal(result.expireIds.length, 3);
    assert.equal(result.snapshots, 2);
    assert.equal(result.verifiedAnchor, uploaded.id);
    assert((await verifyEncryptedBackup(f.options, uploaded.id)).verified);
    assert.deepEqual(
      (await inspectEncryptedBackups(otherOptions)).snapshots.map((s) => s.id),
      [otherUpload.id],
    );
    assert(
      (await verifyEncryptedBackup(otherOptions, otherUpload.id)).verified,
    );
    await assert.rejects(
      () => verifyEncryptedBackup(f.options, otherUpload.id),
      EncryptedBackupUnavailable,
    );
    for (const id of preview.expireIds)
      await assert.rejects(
        () => verifyEncryptedBackup(f.options, id),
        EncryptedBackupUnavailable,
      );
    assert.deepEqual(await fingerprints(current), before);
    assert.deepEqual(await fingerprints(otherSource), originalOther);
    // The actual repository stores encrypted data/metadata, not plaintext maker notes.
    async function encrypted(folder: string) {
      for (const item of await readdir(folder, { withFileTypes: true })) {
        const file = path.join(folder, item.name);
        if (item.isDirectory()) await encrypted(file);
        else
          assert.equal(
            (await readFile(file)).includes(Buffer.from(marker)),
            false,
          );
      }
    }
    await encrypted(f.options.repository);
  } finally {
    await f.close();
  }
});

test("wrong repository/authority pins, unsafe password files, bad sources and corrupt snapshots refuse without remote changes", async () => {
  const f = await fixture();
  try {
    const source = await f.snapshot("safe"),
      uploaded = await uploadEncryptedBackup(f.options, source);
    const expected = (await inspectEncryptedBackups(f.options)).snapshots;
    for (const options of [
      { ...f.options, repositoryId: "a".repeat(64) },
      { ...f.options, authorityId: randomUUID() },
      { ...f.options, authorityFingerprint: "b".repeat(64) },
    ])
      await assert.rejects(
        () => uploadEncryptedBackup(options, source),
        EncryptedBackupUnavailable,
      );
    const alias = path.join(f.root, "source-alias");
    await symlink(source, alias);
    for (const input of [alias, ".", f.root])
      await assert.rejects(
        () => uploadEncryptedBackup(f.options, input),
        EncryptedBackupUnavailable,
      );
    const password = path.join(f.root, "bad-password");
    await writeFile(password, "wrong-private-passphrase-72b714", {
      mode: 0o600,
    });
    await assert.rejects(
      () => inspectEncryptedBackups({ ...f.options, passwordFile: password }),
      EncryptedBackupUnavailable,
    );
    await chmod(password, 0o644);
    await assert.rejects(
      () => inspectEncryptedBackups({ ...f.options, passwordFile: password }),
      EncryptedBackupUnavailable,
    );
    const linked = path.join(f.root, "linked-password");
    await symlink(f.options.passwordFile, linked);
    await assert.rejects(
      () => inspectEncryptedBackups({ ...f.options, passwordFile: linked }),
      EncryptedBackupUnavailable,
    );
    const hard = path.join(f.root, "hard-password");
    await link(f.options.passwordFile, hard);
    await assert.rejects(
      () => inspectEncryptedBackups(f.options),
      EncryptedBackupUnavailable,
    );
    await rm(hard);
    const bytes = await readFile(path.join(source, "data/studio.sqlite"));
    await writeFile(
      path.join(source, "data/studio.sqlite"),
      "corrupt-private-diagnostic-canary",
    );
    await assert.rejects(
      () => uploadEncryptedBackup(f.options, source),
      (error) =>
        error instanceof EncryptedBackupUnavailable &&
        !error.message.includes("diagnostic-canary"),
    );
    await writeFile(path.join(source, "data/studio.sqlite"), bytes);
    assert.deepEqual(
      (await inspectEncryptedBackups(f.options)).snapshots,
      expected,
    );
    assert((await verifyEncryptedBackup(f.options, uploaded.id)).verified);
  } finally {
    await f.close();
  }
});

test("stale uploads and retention without a fresh verified anchor refuse; historical explicit verification remains possible", async () => {
  const f = await fixture();
  try {
    const source = await f.snapshot("historical");
    await f.historical(source, 60);
    await f.historical(source, 50);
    await f.historical(source, 40);
    const before = (await inspectEncryptedBackups(f.options)).snapshots;
    assert.equal(
      (await expireEncryptedBackups(f.options, { keepDays: 7, keepLast: 2 }))
        .latestFresh,
      false,
    );
    await assert.rejects(
      () =>
        expireEncryptedBackups(f.options, {
          keepDays: 7,
          keepLast: 2,
          apply: true,
        }),
      EncryptedBackupUnavailable,
    );
    assert((await verifyEncryptedBackup(f.options, before[0].id)).verified);
    const file = path.join(source, "manifest.json"),
      manifest = JSON.parse(await readFile(file, "utf8"));
    manifest.createdAt = new Date(Date.now() - 2 * 86400000).toISOString();
    await writeFile(file, JSON.stringify(manifest));
    await assert.rejects(
      () => uploadEncryptedBackup(f.options, source),
      EncryptedBackupUnavailable,
    );
    assert.deepEqual(
      (await inspectEncryptedBackups(f.options)).snapshots,
      before,
    );
    await f.historical(source, -2);
    assert.equal((await inspectEncryptedBackups(f.options)).latestFresh, false);
    await assert.rejects(
      () =>
        expireEncryptedBackups(f.options, {
          keepDays: 7,
          keepLast: 2,
          apply: true,
        }),
      EncryptedBackupUnavailable,
    );
    for (const policy of [
      { keepDays: 0 },
      { keepDays: 366 },
      { keepLast: 1 },
      { keepLast: 61 },
      { keepLast: 2.5 },
    ])
      await assert.rejects(
        () => expireEncryptedBackups(f.options, policy),
        EncryptedBackupUnavailable,
      );
  } finally {
    await f.close();
  }
});

test("empty repositories and real CLI inspection are private, bounded and never initialize application storage", async () => {
  const f = await fixture();
  try {
    assert.deepEqual((await inspectEncryptedBackups(f.options)).snapshots, []);
    assert.equal(
      (await expireEncryptedBackups(f.options, { apply: true })).applied,
      false,
    );
    const pins = [
      "--repository-id",
      f.options.repositoryId,
      "--authority-id",
      f.options.authorityId,
      "--authority-fingerprint",
      f.options.authorityFingerprint,
    ];
    const command = [
      "--import",
      import.meta.resolve("tsx"),
      path.resolve("scripts/encrypted-backup.ts"),
    ];
    const env = { ...f.env, REELCHEMY_RESTIC_BINARY: binary };
    const output = execFileSync(
      process.execPath,
      [...command, "inspect", ...pins],
      { cwd: f.root, env, encoding: "utf8", timeout: 30000 },
    );
    assert.deepEqual(JSON.parse(output).snapshots, []);
    for (const args of [
      ["upload", ...pins, "--snapshot", "."],
      ["inspect", ...pins, "--apply"],
      ["expire", ...pins, "--keep-last", "1"],
      ["restore", ...pins],
    ]) {
      const result = await new Promise<{ code: number | null; output: string }>(
        (resolve, reject) => {
          const child = spawn(process.execPath, [...command, ...args], {
            cwd: f.root,
            env,
          });
          let output = "";
          child.stdout.on("data", (b) => (output += b.toString()));
          child.stderr.on("data", (b) => (output += b.toString()));
          child.once("error", reject);
          child.once("close", (code) => resolve({ code, output }));
        },
      );
      assert.equal(result.code, 1);
      assert.equal(
        result.output.trim(),
        new EncryptedBackupUnavailable().message,
      );
    }
    assert.equal((await readdir(f.root)).includes(".data"), false);
    assert.deepEqual((await inspectEncryptedBackups(f.options)).snapshots, []);
  } finally {
    await f.close();
  }
});

test("operator subprocesses inherit a pinned password descriptor and selected backend credentials, excluding application and command configuration", async () => {
  const f = await fixture();
  const names = [
    "AI_API_KEY",
    "SMTP_PASSWORD",
    "BETTER_AUTH_SECRET",
    "RESTIC_PASSWORD_COMMAND",
    "AWS_ACCESS_KEY_ID",
  ] as const;
  const original = names.map((name) => process.env[name]);
  try {
    for (const name of names) process.env[name] = `synthetic-${name}`;
    const capture = path.join(f.root, "capture.json"),
      fake = path.join(f.root, "restic-fixture");
    await writeFile(
      fake,
      `#!/usr/bin/env node\nconst fs = require('node:fs');\nfs.writeFileSync(${JSON.stringify(capture)}, JSON.stringify({ names: Object.keys(process.env), passwordPath: process.env.RESTIC_PASSWORD_FILE, regular: fs.fstatSync(3).isFile() }));\nconsole.log(JSON.stringify(process.argv.includes('cat') ? { id: ${JSON.stringify(f.options.repositoryId)}, version: 2 } : []));\n`,
      { mode: 0o700 },
    );
    await inspectEncryptedBackups({ ...f.options, binary: fake });
    const recorded = JSON.parse(await readFile(capture, "utf8"));
    assert.equal(recorded.regular, true);
    assert.equal(recorded.passwordPath, "/proc/self/fd/3");
    assert(recorded.names.includes("AWS_ACCESS_KEY_ID"));
    for (const name of names.slice(0, -1))
      assert(!recorded.names.includes(name));
  } finally {
    names.forEach((name, i) => {
      if (original[i] === undefined) delete process.env[name];
      else process.env[name] = original[i];
    });
    await f.close();
  }
});

test("deadline/cancellation await operator child teardown and keep raw credential diagnostics out of errors", async () => {
  const f = await fixture();
  try {
    for (const mode of ["timeout", "cancel", "output"] as const) {
      const pidFile = path.join(f.root, `pid-${mode}`),
        closed = path.join(f.root, `closed-${mode}`),
        fake = path.join(f.root, `restic-${mode}`);
      await writeFile(
        fake,
        `#!/usr/bin/env node\nconst fs = require('node:fs');\nprocess.on('SIGTERM', () => setTimeout(() => { fs.writeFileSync(${JSON.stringify(closed)}, 'closed'); process.exit(0); }, 30));\nfs.writeFileSync(${JSON.stringify(pidFile)}, String(process.pid));\n${mode === "output" ? "process.stderr.write('synthetic-private-storage-credential-canary'); process.stderr.write(Buffer.alloc(13 * 1024 ** 2, 'x'));" : ""}\nsetInterval(() => {}, 1000);\n`,
        { mode: 0o700 },
      );
      const controller = new AbortController();
      const operation = inspectEncryptedBackups({
        ...f.options,
        binary: fake,
        signal: controller.signal,
        timeoutMs: mode === "timeout" ? 500 : 5000,
      });
      const rejected = assert.rejects(
        operation,
        (error) =>
          error instanceof EncryptedBackupUnavailable &&
          error.message === new EncryptedBackupUnavailable().message,
      );
      let pid: number | undefined;
      for (let i = 0; i < 80; i++) {
        const value = await readFile(pidFile, "utf8").catch(() => undefined);
        if (value) {
          pid = Number(value);
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      assert(pid);
      if (mode === "cancel") controller.abort();
      await rejected;
      assert.equal(await readFile(closed, "utf8"), "closed");
      assert.throws(
        () => process.kill(pid!, 0),
        (error) => (error as NodeJS.ErrnoException).code === "ESRCH",
      );
    }
  } finally {
    await f.close();
  }
});

test("a held real repository backup lock refuses pruning without deleting retained snapshots or forcibly unlocking", async () => {
  const f = await fixture();
  let holder: ReturnType<typeof spawn> | undefined,
    stopped: Promise<void> | undefined;
  try {
    const source = await f.snapshot("lock");
    for (const days of [60, 50, 40]) await f.historical(source, days);
    await uploadEncryptedBackup(f.options, source);
    const before = (await inspectEncryptedBackups(f.options)).snapshots;
    holder = spawn(
      binary,
      [
        "--no-cache",
        "backup",
        "--stdin",
        "--stdin-filename",
        "held-operator-input",
      ],
      { env: f.env, stdio: ["pipe", "ignore", "ignore"] },
    );
    stopped = new Promise((resolve, reject) => {
      holder!.once("error", reject);
      holder!.once("close", () => resolve());
    });
    holder.stdin!.write("synthetic-held-backup");
    let locked = false;
    for (let i = 0; i < 80; i++) {
      if ((await readdir(path.join(f.options.repository, "locks"))).length) {
        locked = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    assert(locked);
    await assert.rejects(
      () =>
        expireEncryptedBackups(f.options, {
          keepDays: 7,
          keepLast: 2,
          apply: true,
        }),
      EncryptedBackupUnavailable,
    );
    assert.deepEqual(
      (await inspectEncryptedBackups(f.options)).snapshots,
      before,
    );
    assert(
      (await readdir(path.join(f.options.repository, "locks"))).length > 0,
    );
  } finally {
    holder?.kill("SIGTERM");
    await stopped;
    await f.close();
  }
});

test("cancelled local checksum verification refuses without changing a completed snapshot", async () => {
  const f = await fixture();
  try {
    const source = await f.snapshot("cancelled-local"),
      before = await fingerprints(source);
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(
      () => verifyBackup(source, { signal: controller.signal }),
      (error) => error instanceof Error && error.name === "AbortError",
    );
    assert.deepEqual(await fingerprints(source), before);
    assert.equal(
      (await inspectEncryptedBackups(f.options)).snapshots.length,
      0,
    );
  } finally {
    await f.close();
  }
});
