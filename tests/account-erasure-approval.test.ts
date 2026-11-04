import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import {
  accountErasurePolicy,
  AccountErasureUnavailable,
} from "../src/lib/account-erasure-policy";
import {
  approveErasure,
  verifyErasureApproval,
  erasureOwnerHash,
  createErasureReceipt,
  erasureReceiptHash,
  erasureHashEqual,
  type ErasureIntent,
} from "../src/lib/account-erasure-approval";
test("erasure approvals bind every authority field without retaining the owner or private receipt", () => {
  const key = randomBytes(32),
    owner = "synthetic-owner",
    receipt = createErasureReceipt();
  const intent: ErasureIntent = {
    format: "reelchemy-account-erasure-v1",
    requestId: randomUUID(),
    workspaceId: randomUUID(),
    ownerHash: erasureOwnerHash(key, owner),
    receiptHash: erasureReceiptHash(receipt),
    requestedAt: new Date().toISOString(),
    sequence: 1,
  };
  const approval = approveErasure(key, intent);
  assert.deepEqual(verifyErasureApproval(key, approval), approval);
  assert(!JSON.stringify(approval).includes(owner));
  assert(!JSON.stringify(approval).includes(receipt));
  for (const patch of [
    { requestId: randomUUID() },
    { workspaceId: randomUUID() },
    { ownerHash: erasureOwnerHash(key, "other-owner") },
    { receiptHash: erasureReceiptHash(createErasureReceipt()) },
    { requestedAt: new Date(Date.now() - 10000).toISOString() },
    { sequence: 2 },
    { format: "future-erasure-v2" },
    { extra: "unsupported authority" },
  ])
    assert.throws(
      () => verifyErasureApproval(key, { ...approval, ...patch }),
      AccountErasureUnavailable,
    );
  assert.throws(
    () => verifyErasureApproval(randomBytes(32), approval),
    AccountErasureUnavailable,
  );
  assert.throws(
    () => approveErasure(Buffer.alloc(31), intent),
    AccountErasureUnavailable,
  );
  assert.equal(erasureOwnerHash(key, owner), intent.ownerHash);
  assert.notEqual(erasureOwnerHash(randomBytes(32), owner), intent.ownerHash);
  assert.throws(
    () => erasureOwnerHash(key, "owner\0other"),
    AccountErasureUnavailable,
  );
});
test("receipts are canonical private 256-bit challenges and policy cannot silently disable journal bounds", () => {
  const receipt = createErasureReceipt(),
    hash = erasureReceiptHash(receipt);
  assert.equal(Buffer.from(receipt, "base64url").length, 32);
  assert(erasureHashEqual(hash, erasureReceiptHash(receipt)));
  assert(!erasureHashEqual(hash, "bad"));
  const alphabet =
      "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_",
    last = alphabet.indexOf(receipt.at(-1)!);
  const alias = receipt.slice(0, -1) + alphabet[last + 1];
  assert.equal(
    Buffer.from(alias, "base64url").toString("hex"),
    Buffer.from(receipt, "base64url").toString("hex"),
  );
  assert.throws(() => erasureReceiptHash(alias), AccountErasureUnavailable);
  for (const invalid of [
    receipt + "=",
    receipt + "secret",
    "",
    null,
    Buffer.from(receipt),
  ])
    assert.throws(
      () => erasureReceiptHash(invalid as string),
      AccountErasureUnavailable,
    );
  assert.deepEqual(accountErasurePolicy({}), {
    pending: 100,
    journal: 1000000,
  });
  for (const value of ["0", "-1", "1.5", "2e3", " 100", "10001"])
    assert.throws(
      () => accountErasurePolicy({ REELCHEMY_ERASURE_PENDING_COUNT: value }),
      AccountErasureUnavailable,
    );
  assert.throws(
    () => accountErasurePolicy({ REELCHEMY_ERASURE_JOURNAL_COUNT: "99" }),
    AccountErasureUnavailable,
  );
});
