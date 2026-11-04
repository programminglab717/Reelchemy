import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";
import {
  initializePrivacyVault,
  recordErasureApproval,
  type PrivacyVault,
} from "../src/lib/privacy-vault";
import { createErasureReceipt } from "../src/lib/account-erasure-approval";
import {
  migrateAuthErasures,
  assertAuthErasureSchema,
  revokeApprovedAuthSessions,
  finishApprovedAuthErasure,
  type AuthErasureContext,
} from "../src/lib/auth-erasure-store";
import {
  AccountErasureConflict,
  AccountErasureUnavailable,
} from "../src/lib/account-erasure-policy";
function fixture(run: (db: Database.Database, vault: PrivacyVault) => void) {
  const root = mkdtempSync(path.join(tmpdir(), "reelchemy-auth-erasure-")),
    db = new Database(":memory:");
  try {
    db.exec(
      "CREATE TABLE user(id TEXT PRIMARY KEY,email TEXT UNIQUE,emailVerified INTEGER);CREATE TABLE session(id TEXT PRIMARY KEY,userId TEXT,token TEXT);CREATE TABLE account(id TEXT PRIMARY KEY,userId TEXT,password TEXT);CREATE TABLE verification(id TEXT PRIMARY KEY,value TEXT);",
    );
    const vault = initializePrivacyVault(path.join(root, "vault"));
    migrateAuthErasures(db, vault);
    run(db, vault);
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
}
function user(db: Database.Database, id: string, email: string) {
  db.prepare("INSERT INTO user VALUES(?,?,1)").run(id, email);
  db.prepare("INSERT INTO account VALUES(?,?,?)").run(
    randomUUID(),
    id,
    "synthetic-password-hash",
  );
  db.prepare("INSERT INTO session VALUES(?,?,?)").run(
    randomUUID(),
    id,
    randomUUID(),
  );
  db.prepare("INSERT INTO verification VALUES(?,?)").run(randomUUID(), id);
}
function approve(vault: PrivacyVault, ownerId: string): AuthErasureContext {
  const input = {
    ownerId,
    workspaceId: randomUUID(),
    requestId: randomUUID(),
    receipt: createErasureReceipt(),
  };
  recordErasureApproval(vault, input);
  return input;
}
test("independent approval prevents a new session before local revocation, then credentials erase without changing another account", () =>
  fixture((db, vault) => {
    user(db, "owner-A", "same@example.test");
    user(db, "owner-B", "other@example.test");
    const context = approve(vault, "owner-A");
    assert.throws(
      () =>
        db
          .prepare("INSERT INTO session VALUES(?,?,?)")
          .run(randomUUID(), "owner-A", randomUUID()),
      /Account deletion/,
    );
    assert.deepEqual(revokeApprovedAuthSessions(db, vault, context), {
      sessions: 1,
    });
    assert.equal(
      (
        db
          .prepare("SELECT count(*) n FROM verification WHERE value=?")
          .get("owner-A") as { n: number }
      ).n,
      0,
    );
    assert.throws(
      () =>
        db.prepare("UPDATE user SET emailVerified=1 WHERE id=?").run("owner-A"),
      /Account deletion/,
    );
    assert.throws(
      () =>
        db
          .prepare("INSERT INTO account VALUES(?,?,?)")
          .run(randomUUID(), "owner-A", "restored-hash"),
      /Account deletion/,
    );
    assert.deepEqual(finishApprovedAuthErasure(db, vault, context), {
      users: 1,
    });
    assert.deepEqual(finishApprovedAuthErasure(db, vault, context), {
      users: 0,
    });
    assert.equal(
      (
        db.prepare("SELECT count(*) n FROM user WHERE id=?").get("owner-B") as {
          n: number;
        }
      ).n,
      1,
    );
    assert.equal(
      (
        db
          .prepare("SELECT count(*) n FROM account WHERE userId=?")
          .get("owner-B") as { n: number }
      ).n,
      1,
    );
    assert.throws(
      () =>
        db
          .prepare("INSERT INTO user VALUES(?,?,0)")
          .run("owner-A", "same@example.test"),
      /Account deletion/,
    );
    user(db, "new-owner-C", "same@example.test");
    assertAuthErasureSchema(db, vault);
    assert.throws(
      () => db.prepare("DELETE FROM auth_erasure_approvals").run(),
      /retained/,
    );
    assert.throws(
      () =>
        db.prepare("UPDATE auth_erasure_protocol SET last_sequence=0").run(),
      /decrease/,
    );
  }));
test("foreign or nonexistent independent authority cannot revoke sessions or delete credentials", () =>
  fixture((db, vault) => {
    user(db, "owner-A", "a@example.test");
    user(db, "owner-B", "b@example.test");
    const context = approve(vault, "owner-A");
    const before = JSON.stringify(
      db.prepare("SELECT * FROM user ORDER BY id").all(),
    );
    assert.throws(
      () =>
        revokeApprovedAuthSessions(db, vault, {
          ...context,
          ownerId: "owner-B",
        }),
      AccountErasureConflict,
    );
    assert.throws(
      () =>
        finishApprovedAuthErasure(db, vault, {
          ...context,
          requestId: randomUUID(),
        }),
      AccountErasureConflict,
    );
    assert.equal(
      JSON.stringify(db.prepare("SELECT * FROM user ORDER BY id").all()),
      before,
    );
    assert.equal(
      (db.prepare("SELECT count(*) n FROM session").get() as { n: number }).n,
      2,
    );
  }));
test("an auth store cannot silently repin to another empty vault or serve a missing privacy schema", () =>
  fixture((db, vault) => {
    assert.throws(
      () => assertAuthErasureSchema(db, { ...vault, id: randomUUID() }),
      AccountErasureUnavailable,
    );
    assert.throws(
      () => migrateAuthErasures(db, { ...vault, id: randomUUID() }),
      AccountErasureUnavailable,
    );
    db.exec("DROP TRIGGER auth_erasure_session_insert");
    assert.throws(
      () => assertAuthErasureSchema(db, vault),
      AccountErasureUnavailable,
    );
    migrateAuthErasures(db, vault);
    assertAuthErasureSchema(db, vault);
  }));
