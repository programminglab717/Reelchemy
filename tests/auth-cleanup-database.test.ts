import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  chmodSync,
  renameSync,
  symlinkSync,
  linkSync,
  unlinkSync,
  existsSync,
} from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";
import { initializePrivacyVault } from "../src/lib/privacy-vault";
import { migrateAuthErasures } from "../src/lib/auth-erasure-store";
import { openAuthCleanupDatabase } from "../src/lib/auth-cleanup-database";
import { AccountErasureUnavailable } from "../src/lib/account-erasure-policy";
test("credential-free cleanup opens only an existing private pinned auth database and detects directory replacement", () => {
  const root = mkdtempSync(
    path.join(tmpdir(), "reelchemy-auth-cleanup-store-"),
  );
  const saved = process.env.REELCHEMY_AUTH_DIR;
  const directory = path.join(root, "auth");
  process.env.REELCHEMY_AUTH_DIR = directory;
  const vault = initializePrivacyVault(path.join(root, "privacy"));
  try {
    assert.throws(
      () => openAuthCleanupDatabase(vault),
      AccountErasureUnavailable,
    );
    assert.equal(existsSync(directory), false);
    mkdirSync(directory, { mode: 0o700 });
    const file = path.join(directory, "auth.sqlite"),
      db = new Database(file);
    db.exec(
      "CREATE TABLE user(id TEXT);CREATE TABLE session(userId TEXT);CREATE TABLE account(userId TEXT);CREATE TABLE verification(value TEXT);",
    );
    migrateAuthErasures(db, vault);
    db.close();
    chmodSync(file, 0o600);
    const opened = openAuthCleanupDatabase(vault);
    try {
      opened.assertCurrent();
      renameSync(directory, directory + "-old");
      mkdirSync(directory, { mode: 0o700 });
      assert.throws(() => opened.assertCurrent(), AccountErasureUnavailable);
    } finally {
      opened.close();
      opened.close();
    }
  } finally {
    if (saved === undefined) delete process.env.REELCHEMY_AUTH_DIR;
    else process.env.REELCHEMY_AUTH_DIR = saved;
    rmSync(root, { recursive: true, force: true });
  }
});
test("cleanup refuses auth symlinks, hard links/public file permissions and a missing privacy schema without migration", () => {
  const root = mkdtempSync(
      path.join(tmpdir(), "reelchemy-auth-cleanup-unsafe-"),
    ),
    saved = process.env.REELCHEMY_AUTH_DIR;
  const directory = path.join(root, "auth");
  mkdirSync(directory, { mode: 0o700 });
  process.env.REELCHEMY_AUTH_DIR = directory;
  const vault = initializePrivacyVault(path.join(root, "privacy")),
    file = path.join(directory, "auth.sqlite");
  try {
    const db = new Database(file);
    db.exec(
      "CREATE TABLE untouched(value TEXT);INSERT INTO untouched VALUES('Synthetic canary');",
    );
    db.close();
    chmodSync(file, 0o600);
    assert.throws(
      () => openAuthCleanupDatabase(vault),
      AccountErasureUnavailable,
    );
    const inspect = new Database(file);
    assert.equal(
      (
        inspect
          .prepare(
            "SELECT count(*) n FROM sqlite_master WHERE name='auth_erasure_protocol'",
          )
          .get() as { n: number }
      ).n,
      0,
    );
    inspect.close();
    chmodSync(file, 0o644);
    assert.throws(
      () => openAuthCleanupDatabase(vault),
      AccountErasureUnavailable,
    );
    chmodSync(file, 0o600);
    renameSync(file, file + "-original");
    linkSync(file + "-original", file);
    assert.throws(
      () => openAuthCleanupDatabase(vault),
      AccountErasureUnavailable,
    );
    unlinkSync(file);
    symlinkSync(file + "-original", file);
    assert.throws(
      () => openAuthCleanupDatabase(vault),
      AccountErasureUnavailable,
    );
  } finally {
    if (saved === undefined) delete process.env.REELCHEMY_AUTH_DIR;
    else process.env.REELCHEMY_AUTH_DIR = saved;
    rmSync(root, { recursive: true, force: true });
  }
});
