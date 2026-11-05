import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import {
  mkdtemp,
  mkdir,
  chmod,
  readFile,
  rm,
  lstat,
  symlink,
  unlink,
  link,
  readdir,
  copyFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import {
  compactInactiveDatabases,
  inspectDatabaseStorage,
  DatabaseCompactionUnavailable,
} from "../src/lib/database-compaction";
const removed = "ERASED_ONLY_PRIVATE_TEXT_83ed7c_";
async function fixture(
  run: (f: {
    root: string;
    data: string;
    auth: string;
    studio: string;
    accounts: string;
  }) => Promise<void>,
) {
  const root = await mkdtemp(path.join(tmpdir(), "reelchemy-db-compact-")),
    data = path.join(root, "data"),
    auth = path.join(root, "auth");
  await mkdir(data, { mode: 0o700 });
  await mkdir(auth, { mode: 0o700 });
  const studio = path.join(data, "studio.sqlite"),
    accounts = path.join(auth, "auth.sqlite");
  try {
    for (const [file, kind] of [
      [studio, "studio"],
      [accounts, "auth"],
    ] as const) {
      const db = new Database(file);
      await chmod(file, 0o600);
      try {
        db.pragma("journal_mode=WAL");
        db.pragma("secure_delete=OFF");
        db.exec(
          kind === "studio"
            ? "CREATE TABLE projects(id TEXT PRIMARY KEY,data TEXT);CREATE TABLE jobs(id TEXT PRIMARY KEY);CREATE TABLE workspaces(id TEXT PRIMARY KEY);INSERT INTO projects VALUES('retained','STILL_OWNED_FILM');"
            : "CREATE TABLE \"user\"(id TEXT PRIMARY KEY,email TEXT);CREATE TABLE session(id TEXT PRIMARY KEY);INSERT INTO \"user\" VALUES('retained','PRIVATE_RETAINED_EMAIL@example.test');",
        );
        db.exec("CREATE TABLE removed(id INTEGER PRIMARY KEY,data TEXT)");
        db.transaction(() => {
          for (let i = 0; i < 24; i++)
            db.prepare("INSERT INTO removed(data) VALUES(?)").run(
              removed.repeat(2048),
            );
        })();
        db.exec("DELETE FROM removed");
      } finally {
        db.close();
      }
      assert((await readFile(file)).includes(Buffer.from(removed)));
    }
    await run({ root, data, auth, studio, accounts });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
const rows = (file: string) => {
  const db = new Database(file, { readonly: true });
  try {
    return (
      JSON.stringify(
        db.prepare("SELECT name,sql FROM sqlite_master ORDER BY name").all(),
      ) +
      JSON.stringify(
        db
          .prepare(
            file.endsWith("auth.sqlite")
              ? 'SELECT * FROM "user"'
              : "SELECT * FROM projects",
          )
          .all(),
      )
    );
  } finally {
    db.close();
  }
};
test("inspection is descriptor-only and compaction clears current free-page bytes and WAL while retaining rows, schema and database inodes", async () =>
  fixture(async (f) => {
    const before = await Promise.all([
        readFile(f.studio),
        readFile(f.accounts),
      ]),
      ids = await Promise.all([lstat(f.studio), lstat(f.accounts)]),
      logical = [rows(f.studio), rows(f.accounts)];
    const names = [await readdir(f.data), await readdir(f.auth)],
      plan = inspectDatabaseStorage(f.data, f.auth);
    assert.equal(plan.databases.length, 2);
    assert(plan.databases.every((d) => d.baseFreePages > 0));
    assert.deepEqual([await readdir(f.data), await readdir(f.auth)], names);
    assert.deepEqual(
      await Promise.all([readFile(f.studio), readFile(f.accounts)]),
      before,
    );
    const historical = path.join(f.root, "historical.sqlite");
    await copyFile(f.studio, historical);
    const result = compactInactiveDatabases(f.data, f.auth);
    assert.equal(result.completed.length, 2);
    assert(
      result.completed.every(
        (d) =>
          d.freePages === 0 &&
          d.after.bytes < d.before.bytes &&
          d.after.walBytes === 0,
      ),
    );
    for (const [i, file] of [f.studio, f.accounts].entries()) {
      const info = await lstat(file);
      assert.equal(info.ino, ids[i].ino);
      assert.equal(info.dev, ids[i].dev);
      assert.equal(rows(file), logical[i]);
      assert(!(await readFile(file)).includes(Buffer.from(removed)));
    }
    assert.deepEqual(
      await readFile(historical),
      before[0],
      "prior backups have separate retention and must never be compacted in place",
    );
    assert(!JSON.stringify(result).includes("PRIVATE_RETAINED_EMAIL"));
  }));
test("a genuine open WAL reader blocks both-store maintenance and keeps retained data and free-page payload intact", async () =>
  fixture(async (f) => {
    const busy = new Database(f.studio);
    busy.prepare("SELECT * FROM projects").all();
    try {
      assert.throws(
        () => compactInactiveDatabases(f.data, f.auth),
        DatabaseCompactionUnavailable,
      );
      assert.equal(
        (busy.prepare("SELECT data FROM projects").get() as { data: string })
          .data,
        "STILL_OWNED_FILM",
      );
      assert((await readFile(f.accounts)).includes(Buffer.from(removed)));
    } finally {
      busy.close();
    }
    assert.equal(compactInactiveDatabases(f.data, f.auth).completed.length, 2);
  }));
test("missing scopes, changed roles, unsafe permissions, links and sidecar substitution refuse without adopting or changing external data", async () =>
  fixture(async (f) => {
    const missing = path.join(f.root, "missing");
    assert.throws(
      () => inspectDatabaseStorage(missing, f.auth),
      DatabaseCompactionUnavailable,
    );
    assert.throws(
      () => compactInactiveDatabases(f.data, missing),
      DatabaseCompactionUnavailable,
    );
    await assert.rejects(lstat(missing), { code: "ENOENT" });
    await chmod(f.accounts, 0o640);
    assert.throws(
      () => compactInactiveDatabases(f.data, f.auth),
      DatabaseCompactionUnavailable,
    );
    await chmod(f.accounts, 0o600);
    const target = path.join(f.root, "outside.sqlite");
    await copyFile(f.accounts, target);
    const before = await readFile(target);
    await symlink(target, f.studio + "-wal");
    assert.throws(
      () => inspectDatabaseStorage(f.data, f.auth),
      DatabaseCompactionUnavailable,
    );
    assert.throws(
      () => compactInactiveDatabases(f.data, f.auth),
      DatabaseCompactionUnavailable,
    );
    await unlink(f.studio + "-wal");
    await link(f.accounts, path.join(f.root, "hardlink"));
    assert.throws(
      () => compactInactiveDatabases(f.data, f.auth),
      DatabaseCompactionUnavailable,
    );
    await unlink(path.join(f.root, "hardlink"));
    const auth = new Database(f.accounts);
    auth.exec("DROP TABLE session");
    auth.close();
    assert.throws(
      () => compactInactiveDatabases(f.data, f.auth),
      DatabaseCompactionUnavailable,
    );
    assert(
      (await readFile(f.studio)).includes(Buffer.from(removed)),
      "both roles must be checked before either VACUUM",
    );
    assert.deepEqual(await readFile(target), before);
  }));
test("the real operator command uses explicit scopes without service credentials, migrations, source initialization or private row output", async () =>
  fixture(async (f) => {
    const environment: NodeJS.ProcessEnv = {
      PATH: process.env.PATH,
      LANG: process.env.LANG,
      NODE_ENV: "test",
    };
    const run = (args: string[]) =>
      execFileSync(
        process.execPath,
        ["--import", "tsx", "scripts/database-compaction.ts", ...args],
        { env: environment, encoding: "utf8", timeout: 15000 },
      );
    const args = ["--data", f.data, "--auth", f.auth];
    const before = await readFile(f.studio);
    const plan = JSON.parse(run(args));
    assert.equal(plan.databases.length, 2);
    assert.deepEqual(await readFile(f.studio), before);
    const result = run([...args, "--apply"]);
    assert.equal(JSON.parse(result).completed.length, 2);
    assert(!result.includes("PRIVATE_RETAINED_EMAIL"));
    for (const invalid of [
      [],
      ["--apply"],
      ["--data", f.data],
      [...args, "--unknown"],
    ])
      assert.throws(() => run(invalid));
    assert.equal(rows(f.studio).includes("STILL_OWNED_FILM"), true);
  }));

test("private deletion clears newly removed overflow payload on its writer connection while leaving retained data intact", async () => {
  const { enableSecureDeletion } = await import("../src/lib/sqlite-private");
  const root = await mkdtemp(path.join(tmpdir(), "reelchemy-secure-delete-")),
    file = path.join(root, "owned.sqlite");
  const marker = "JUST_REMOVED_PRIVATE_OVERFLOW_67bd5";
  const db = new Database(file);
  try {
    try {
      enableSecureDeletion(db);
      db.pragma("journal_mode=WAL");
      db.exec("CREATE TABLE content(id INTEGER PRIMARY KEY,data TEXT)");
      db.prepare("INSERT INTO content VALUES(1,?)").run(marker.repeat(4096));
      db.exec(
        "INSERT INTO content VALUES(2,'RETAINED');DELETE FROM content WHERE id=1",
      );
      assert.equal(
        (
          db.prepare("SELECT data FROM content WHERE id=2").get() as {
            data: string;
          }
        ).data,
        "RETAINED",
      );
    } finally {
      db.close();
    }
    assert(!(await readFile(file)).includes(Buffer.from(marker)));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
