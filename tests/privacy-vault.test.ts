import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  rmSync,
  existsSync,
  statSync,
  symlinkSync,
} from "node:fs";
import { randomBytes, randomUUID } from "node:crypto";
import path from "node:path";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";
import {
  initializePrivacyVault,
  recordErasureApproval,
  erasureStatusByReceipt,
  ownerHasErasureApproval,
  pendingErasureApprovals,
  advanceErasureState,
  privacyVaultWatermark,
  type PrivacyVault,
} from "../src/lib/privacy-vault";
import {
  createErasureReceipt,
  erasureOwnerHash,
  erasureReceiptHash,
} from "../src/lib/account-erasure-approval";
import {
  AccountErasureConflict,
  AccountErasureCapacity,
  AccountErasureUnavailable,
} from "../src/lib/account-erasure-policy";
function fixture(run: (vault: PrivacyVault, root: string) => void) {
  const root = mkdtempSync(path.join(tmpdir(), "reelchemy-privacy-vault-"));
  try {
    const vault = initializePrivacyVault(path.join(root, "vault"));
    run(vault, root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
function request(ownerId = "synthetic-owner") {
  return {
    ownerId,
    workspaceId: randomUUID(),
    requestId: randomUUID(),
    receipt: createErasureReceipt(),
  };
}

test("privacy vault requires explicit empty initialization and pins its external identity/key without recreating missing state", () =>
  fixture((vault, root) => {
    const files = readdirSync(vault.directory),
      bytes = files.map((name) =>
        readFileSync(path.join(vault.directory, name)),
      );
    for (const name of ["approval.key", "journal.sqlite", "vault.json"])
      assert.equal(
        statSync(path.join(vault.directory, name)).mode & 0o777,
        0o600,
      );
    assert.equal(statSync(vault.directory).mode & 0o777, 0o700);
    assert.equal(privacyVaultWatermark(vault).sequence, 0);
    assert.throws(
      () => initializePrivacyVault(vault.directory),
      AccountErasureConflict,
    );
    const missing = path.join(root, "missing");
    assert.throws(
      () => privacyVaultWatermark({ ...vault, directory: missing }),
      AccountErasureUnavailable,
    );
    assert(!existsSync(missing));
    assert.throws(
      () => privacyVaultWatermark({ ...vault, id: randomUUID() }),
      AccountErasureUnavailable,
    );
    assert.throws(
      () => privacyVaultWatermark({ ...vault, keyFingerprint: "0".repeat(64) }),
      AccountErasureUnavailable,
    );
    assert.deepEqual(
      files.map((name) => readFileSync(path.join(vault.directory, name))),
      bytes,
    );
    const link = path.join(root, "link");
    symlinkSync(vault.directory, link);
    assert.throws(
      () => privacyVaultWatermark({ ...vault, directory: link }),
      AccountErasureUnavailable,
    );
    const partial = path.join(root, "partial");
    mkdirSync(partial);
    writeFileSync(path.join(partial, "approval.key"), "partial initialization");
    assert.throws(
      () => initializePrivacyVault(partial),
      AccountErasureConflict,
    );
    assert.equal(
      readFileSync(path.join(partial, "approval.key"), "utf8"),
      "partial initialization",
    );
  }));

test("approved intent/receipt replay survives progress and capacity while retaining old identity denial and bounded private status", () =>
  fixture((vault) => {
    const saved = [
      process.env.REELCHEMY_ERASURE_PENDING_COUNT,
      process.env.REELCHEMY_ERASURE_JOURNAL_COUNT,
    ];
    process.env.REELCHEMY_ERASURE_PENDING_COUNT = "1";
    process.env.REELCHEMY_ERASURE_JOURNAL_COUNT = "2";
    try {
      const first = request(),
        second = request("other-owner"),
        one = recordErasureApproval(vault, first);
      assert.equal(one.approval.sequence, 1);
      assert.equal(one.status.state, "requested");
      assert(ownerHasErasureApproval(vault, first.ownerId));
      assert(!ownerHasErasureApproval(vault, "unrelated"));
      const own = erasureStatusByReceipt(
        vault,
        first.requestId,
        first.receipt,
      )!;
      assert.deepEqual(Object.keys(own).sort(), [
        "requestId",
        "requestedAt",
        "state",
        "updatedAt",
      ]);
      for (const value of [
        first.ownerId,
        first.workspaceId,
        first.receipt,
        one.approval.ownerHash,
      ])
        assert(!JSON.stringify(own).includes(value));
      assert.equal(
        erasureStatusByReceipt(vault, first.requestId, createErasureReceipt()),
        undefined,
      );
      assert.equal(
        erasureStatusByReceipt(vault, randomUUID(), first.receipt),
        undefined,
      );
      assert.equal(
        erasureStatusByReceipt(vault, first.requestId, "malformed"),
        undefined,
      );
      assert.throws(
        () =>
          recordErasureApproval(vault, {
            ...first,
            receipt: createErasureReceipt(),
          }),
        AccountErasureConflict,
      );
      assert.throws(
        () => recordErasureApproval(vault, { ...first, ownerId: "foreign" }),
        AccountErasureConflict,
      );
      assert.throws(
        () =>
          recordErasureApproval(vault, { ...first, requestId: randomUUID() }),
        AccountErasureConflict,
      );
      assert.throws(
        () => recordErasureApproval(vault, second),
        AccountErasureCapacity,
      );
      assert.deepEqual(
        recordErasureApproval(vault, first).approval,
        one.approval,
      );
      assert.equal(
        advanceErasureState(vault, first.requestId, "requested", "cleaning") &&
          advanceErasureState(vault, first.requestId, "cleaning", "blocked") &&
          advanceErasureState(vault, first.requestId, "blocked", "cleaning") &&
          advanceErasureState(vault, first.requestId, "cleaning", "completed")
            ?.state,
        "completed",
      );
      assert.equal(
        advanceErasureState(vault, first.requestId, "requested", "cleaning"),
        false,
      );
      assert.throws(
        () =>
          advanceErasureState(vault, first.requestId, "completed", "cleaning"),
        AccountErasureConflict,
      );
      assert(ownerHasErasureApproval(vault, first.ownerId));
      const two = recordErasureApproval(vault, second);
      assert.equal(two.approval.sequence, 2);
      assert.deepEqual(
        pendingErasureApprovals(vault).map((row) => row.approval.requestId),
        [second.requestId],
      );
      assert.deepEqual(pendingErasureApprovals(vault, 2), []);
      assert.throws(
        () => recordErasureApproval(vault, request("third")),
        AccountErasureCapacity,
      );
      assert.deepEqual(
        recordErasureApproval(vault, first).approval,
        one.approval,
      );
      assert.equal(privacyVaultWatermark(vault, 2).sequence, 2);
      assert.throws(
        () => privacyVaultWatermark(vault, 3),
        AccountErasureUnavailable,
      );
      assert.throws(
        () => pendingErasureApprovals(vault, 0, 11),
        AccountErasureUnavailable,
      );
    } finally {
      for (const [index, key] of [
        "REELCHEMY_ERASURE_PENDING_COUNT",
        "REELCHEMY_ERASURE_JOURNAL_COUNT",
      ].entries()) {
        if (saved[index] === undefined) delete process.env[key];
        else process.env[key] = saved[index];
      }
    }
  }));

test("journal SQL cannot rewrite/delete authority and forged packet or replacement key fails closed", () =>
  fixture((vault) => {
    const own = request(),
      record = recordErasureApproval(vault, own),
      file = path.join(vault.directory, "journal.sqlite"),
      db = new Database(file);
    try {
      assert.throws(
        () =>
          db
            .prepare("DELETE FROM erasure_approvals WHERE id=?")
            .run(own.requestId),
        /retained/,
      );
      assert.throws(
        () =>
          db
            .prepare("UPDATE erasure_approvals SET workspace_id=? WHERE id=?")
            .run(randomUUID(), own.requestId),
        /immutable/,
      );
      assert.throws(
        () => db.prepare("UPDATE vault_identity SET id=?").run(randomUUID()),
        /immutable/,
      );
      assert.throws(
        () => db.prepare("DELETE FROM vault_identity").run(),
        /retained/,
      );
      const forged = request("forged"),
        key = readFileSync(path.join(vault.directory, "approval.key")),
        packet = {
          ...record.approval,
          requestId: forged.requestId,
          workspaceId: forged.workspaceId,
          ownerHash: erasureOwnerHash(key, forged.ownerId),
          receiptHash: erasureReceiptHash(forged.receipt),
          sequence: 2,
        };
      db.prepare("INSERT INTO erasure_approvals VALUES(?,?,?,?,?,?,?,?)").run(
        forged.requestId,
        packet.ownerHash,
        packet.workspaceId,
        packet.receiptHash,
        2,
        JSON.stringify(packet),
        "requested",
        packet.requestedAt,
      );
      assert.throws(
        () => ownerHasErasureApproval(vault, forged.ownerId),
        AccountErasureUnavailable,
      );
      assert.throws(
        () => erasureStatusByReceipt(vault, forged.requestId, forged.receipt),
        AccountErasureUnavailable,
      );
      assert.throws(
        () => pendingErasureApprovals(vault),
        AccountErasureUnavailable,
      );
    } finally {
      db.close();
    }
    const keyFile = path.join(vault.directory, "approval.key"),
      original = readFileSync(keyFile);
    writeFileSync(keyFile, randomBytes(32));
    assert.throws(
      () => ownerHasErasureApproval(vault, own.ownerId),
      AccountErasureUnavailable,
    );
    writeFileSync(keyFile, original);
    assert(ownerHasErasureApproval(vault, own.ownerId));
  }));

test("vault refuses substituted private files and unsupported schema without following an outside key", () => {
  for (const name of ["approval.key", "journal.sqlite", "vault.json"])
    fixture((vault, root) => {
      const outside = path.join(root, "outside");
      writeFileSync(outside, "outside synthetic secret");
      const target = path.join(vault.directory, name);
      rmSync(target);
      symlinkSync(outside, target);
      assert.throws(
        () => privacyVaultWatermark(vault),
        AccountErasureUnavailable,
      );
      assert.equal(readFileSync(outside, "utf8"), "outside synthetic secret");
    });
  fixture((vault) => {
    const file = path.join(vault.directory, "journal.sqlite"),
      db = new Database(file);
    db.pragma("user_version=2");
    db.close();
    const before = readFileSync(file);
    assert.throws(
      () => privacyVaultWatermark(vault),
      AccountErasureUnavailable,
    );
    assert.deepEqual(readFileSync(file), before);
  });
});
