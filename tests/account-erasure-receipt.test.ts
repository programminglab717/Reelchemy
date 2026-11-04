import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createDeletionReceipt,
  parseDeletionReceipt,
  deletionReceiptSecret,
} from "../src/lib/account-erasure-receipt";
import { erasureReceiptHash } from "../src/lib/account-erasure-approval";
test("browser receipts use canonical independent 256-bit secrets and round-trip without credentials or owner data", () => {
  const a = createDeletionReceipt(),
    b = createDeletionReceipt();
  assert.notEqual(a.requestId, b.requestId);
  assert.notEqual(a.receipt, b.receipt);
  assert.equal(Buffer.from(a.receipt, "base64url").length, 32);
  assert.equal(erasureReceiptHash(a.receipt).length, 64);
  assert.deepEqual(parseDeletionReceipt(JSON.stringify(a)), a);
  assert.deepEqual(Object.keys(a).sort(), [
    "createdAt",
    "format",
    "receipt",
    "requestId",
  ]);
  for (const value of [
    "A".repeat(42) + "B",
    a.receipt + "=",
    "x",
    a.receipt.slice(1),
  ])
    assert.equal(deletionReceiptSecret.safeParse(value).success, false);
  for (const value of [
    "not-json",
    JSON.stringify({ ...a, password: "must-not-travel" }),
    JSON.stringify({ ...a, format: "project-recovery" }),
    " ".repeat(2049),
  ])
    assert.throws(() => parseDeletionReceipt(value));
});
