import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  rmSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { tmpdir } from "node:os";
import {
  initializePrivacyVault,
  ownerHasErasureApproval,
  recordErasureApproval,
  type PrivacyVault,
} from "../src/lib/privacy-vault";
import {
  approveErasureWithMail,
  reconcilePreparedErasureMail,
} from "../src/lib/account-erasure-mail";
import {
  enqueueMail,
  prepareAccountMail,
  claimMail,
  mailOutboxStatus,
  type PreparedAccountMail,
} from "../src/lib/mail-outbox";
import { createErasureReceipt } from "../src/lib/account-erasure-approval";
import {
  AccountErasureCapacity,
  AccountErasureConflict,
  AccountErasureUnavailable,
} from "../src/lib/account-erasure-policy";
function fixture(
  run: (
    vault: PrivacyVault,
    context: PreparedAccountMail,
    directory: string,
  ) => void,
) {
  const root = mkdtempSync(
      path.join(tmpdir(), "reelchemy-erasure-mail-coordinator-"),
    ),
    keys = [
      "REELCHEMY_AUTH_DIR",
      "REELCHEMY_DATA_DIR",
      "REELCHEMY_ARTIFACT_DIR",
      "REELCHEMY_ERASURE_PENDING_COUNT",
    ],
    saved = keys.map((key) => process.env[key]);
  Object.assign(process.env, {
    REELCHEMY_AUTH_DIR: path.join(root, "auth"),
    REELCHEMY_DATA_DIR: path.join(root, "data"),
    REELCHEMY_ARTIFACT_DIR: path.join(root, "artifacts"),
  });
  try {
    run(
      initializePrivacyVault(path.join(root, "vault")),
      {
        accountId: "private-coordinator-owner",
        workspaceId: randomUUID(),
        requestId: randomUUID(),
      },
      path.join(root, "auth/mail"),
    );
  } finally {
    keys.forEach((key, index) => {
      if (saved[index] === undefined) delete process.env[key];
      else process.env[key] = saved[index];
    });
    rmSync(root, { recursive: true, force: true });
  }
}
function files(directory: string) {
  return readdirSync(directory).filter((name) =>
    /^[a-f0-9-]{36}\.json$/.test(name),
  );
}
test("coordinator approves exactly one private intent and resumes the same mail/receipt after a lost acknowledgement", () =>
  fixture((vault, context, directory) => {
    enqueueMail({
      to: "coordinator@example.test",
      accountId: context.accountId,
      subject: "Verify",
      text: "Synthetic private link",
    });
    const receipt = createErasureReceipt(),
      first = approveErasureWithMail(
        vault,
        context,
        "coordinator@example.test",
        receipt,
      );
    assert.equal(first.status.state, "requested");
    assert(ownerHasErasureApproval(vault, context.accountId));
    assert.equal(files(directory).length, 0);
    assert.deepEqual(
      approveErasureWithMail(
        vault,
        context,
        "coordinator@example.test",
        receipt,
      ).approval,
      first.approval,
    );
    assert.equal(first.approval.sequence, 1);
  }));
test("journal capacity refusal withdraws only an unapproved dispatch hold and preserves the queued link", () =>
  fixture((vault, context, directory) => {
    process.env.REELCHEMY_ERASURE_PENDING_COUNT = "1";
    recordErasureApproval(vault, {
      ownerId: "other-private-owner",
      workspaceId: randomUUID(),
      requestId: randomUUID(),
      receipt: createErasureReceipt(),
    });
    enqueueMail({
      to: "coordinator@example.test",
      accountId: context.accountId,
      subject: "Verify",
      text: "Synthetic private link",
    });
    const file = path.join(directory, files(directory)[0]),
      bytes = readFileSync(file);
    assert.throws(
      () =>
        approveErasureWithMail(
          vault,
          context,
          "coordinator@example.test",
          createErasureReceipt(),
        ),
      AccountErasureCapacity,
      AccountErasureConflict,
    );
    assert(!ownerHasErasureApproval(vault, context.accountId));
    assert.deepEqual(readFileSync(file), bytes);
    assert.equal(mailOutboxStatus().paused, 0);
    assert(claimMail());
  }));
test("malformed queue after a committed approval stays blocked and recoverable instead of returning false absence", () =>
  fixture((vault, context, directory) => {
    enqueueMail({
      to: "coordinator@example.test",
      accountId: context.accountId,
      subject: "Verify",
      text: "Synthetic private link",
    });
    enqueueMail({
      to: "other@example.test",
      accountId: "another-owner",
      subject: "Verify",
      text: "Another private link",
    });
    const malformed = files(directory).find(
      (name) =>
        JSON.parse(readFileSync(path.join(directory, name), "utf8"))
          .accountId === "another-owner",
    )!;
    writeFileSync(
      path.join(directory, malformed),
      "malformed private diagnostic",
    );
    const accepted = approveErasureWithMail(
      vault,
      context,
      "coordinator@example.test",
      createErasureReceipt(),
    );
    assert.equal(accepted.status.state, "blocked");
    assert(ownerHasErasureApproval(vault, context.accountId));
    assert.equal(
      readFileSync(path.join(directory, malformed), "utf8"),
      "malformed private diagnostic",
    );
  }));
test("a preparation cannot be withdrawn by confusing another approved request for the same owner with absence", () =>
  fixture((vault, context) => {
    prepareAccountMail(context, "coordinator@example.test");
    recordErasureApproval(vault, {
      ownerId: context.accountId,
      workspaceId: context.workspaceId,
      requestId: randomUUID(),
      receipt: createErasureReceipt(),
    });
    assert.throws(() =>
      reconcilePreparedErasureMail(vault, context, {
        withdrawImmediately: true,
      }),
    );
    assert.equal(mailOutboxStatus().pending, 0);
    assert(ownerHasErasureApproval(vault, context.accountId));
    assert.throws(
      () =>
        approveErasureWithMail(
          { ...vault, id: randomUUID() },
          context,
          "coordinator@example.test",
          createErasureReceipt(),
        ),
      AccountErasureUnavailable,
    );
  }));

test("wrong receipt and foreign request reuse cannot change an approved status or create another account's dispatch hold", () =>
  fixture((vault, context) => {
    const receipt = createErasureReceipt(),
      first = approveErasureWithMail(
        vault,
        context,
        "coordinator@example.test",
        receipt,
      );
    assert.throws(
      () =>
        approveErasureWithMail(
          vault,
          context,
          "coordinator@example.test",
          createErasureReceipt(),
        ),
      AccountErasureConflict,
    );
    const foreign = {
      ...context,
      accountId: "another-account",
      workspaceId: randomUUID(),
    };
    assert.throws(
      () =>
        approveErasureWithMail(vault, foreign, "other@example.test", receipt),
      AccountErasureConflict,
    );
    assert.deepEqual(
      approveErasureWithMail(
        vault,
        context,
        "coordinator@example.test",
        receipt,
      ).status,
      first.status,
    );
  }));
