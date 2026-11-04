import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  existsSync,
} from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";
import {
  enqueueMail,
  claimMail,
  settleMail,
  mailOutboxStatus,
  prepareAccountMail,
  commitPreparedAccountMail,
  resolvePreparedAccountMail,
  pendingAccountMailPreparations,
  accountMailCleanupPending,
  type PreparedAccountMail,
} from "../src/lib/mail-outbox";
import { MailUnavailable } from "../src/lib/mail-policy";
import {
  initializePrivacyVault,
  recordErasureApproval,
  ownerHasErasureApproval,
  approvedErasureContext,
  type PrivacyVault,
} from "../src/lib/privacy-vault";
import { createErasureReceipt } from "../src/lib/account-erasure-approval";
const email = "same-address@example.test",
  message = (accountId?: string) => ({
    to: email,
    subject: "Verify",
    text: "Synthetic private link",
    ...(accountId ? { accountId } : {}),
  });
function fixture(
  run: (
    context: PreparedAccountMail,
    vault: PrivacyVault,
    mail: string,
  ) => void,
) {
  const root = mkdtempSync(path.join(tmpdir(), "reelchemy-mail-erasure-")),
    keys = [
      "REELCHEMY_AUTH_DIR",
      "REELCHEMY_DATA_DIR",
      "REELCHEMY_ARTIFACT_DIR",
    ],
    saved = keys.map((key) => process.env[key]);
  Object.assign(process.env, {
    REELCHEMY_AUTH_DIR: path.join(root, "auth"),
    REELCHEMY_DATA_DIR: path.join(root, "data"),
    REELCHEMY_ARTIFACT_DIR: path.join(root, "artifacts"),
  });
  try {
    run(
      {
        accountId: "synthetic-owner-A",
        workspaceId: randomUUID(),
        requestId: randomUUID(),
      },
      initializePrivacyVault(path.join(root, "vault")),
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
function records(directory: string) {
  return readdirSync(directory).filter((name) =>
    /^[a-f0-9-]{36}\.json$/.test(name),
  );
}
function persist(
  vault: PrivacyVault,
  context: PreparedAccountMail,
  receipt = createErasureReceipt(),
) {
  return () =>
    recordErasureApproval(vault, {
      ownerId: context.accountId,
      workspaceId: context.workspaceId,
      requestId: context.requestId,
      receipt,
    });
}

test("a reversible account mail hold pauses owned/legacy dispatch without deleting bodies or blocking another account", () =>
  fixture((context, vault, directory) => {
    enqueueMail(message(context.accountId));
    enqueueMail(message());
    enqueueMail({ ...message("owner-B"), to: "different@example.test" });
    const before = new Map(
      records(directory).map((name) => [
        name,
        readFileSync(path.join(directory, name)),
      ]),
    );
    assert.deepEqual(prepareAccountMail(context, email), context);
    for (const [name, body] of before)
      assert.deepEqual(readFileSync(path.join(directory, name)), body);
    assert.equal(mailOutboxStatus().paused, 2);
    assert.equal(mailOutboxStatus().due, 1);
    assert.equal(pendingAccountMailPreparations().length, 1);
    const other = claimMail()!;
    assert.equal(other.mail.accountId, "owner-B");
    assert(settleMail(other, true));
    assert.equal(claimMail(), undefined);
    assert(!ownerHasErasureApproval(vault, context.accountId));
    assert.equal(
      resolvePreparedAccountMail(context, () => "absent", {
        withdrawImmediately: true,
      }),
      "withdrawn",
    );
    let invoked = false;
    assert.throws(
      () =>
        commitPreparedAccountMail(context, () => {
          invoked = true;
          return persist(vault, context)();
        }),
      MailUnavailable,
    );
    assert.equal(invoked, false);
    assert(!ownerHasErasureApproval(vault, context.accountId));
    assert(claimMail());
  }));

test("signed journal commit permanently suppresses old account/legacy mail while a different account reusing that email remains usable", () =>
  fixture((context, vault, directory) => {
    enqueueMail(message(context.accountId));
    enqueueMail(message());
    enqueueMail(message("new-owner-B"));
    const other = records(directory).find(
        (name) =>
          JSON.parse(readFileSync(path.join(directory, name), "utf8"))
            .accountId === "new-owner-B",
      )!,
      bytes = readFileSync(path.join(directory, other));
    prepareAccountMail(context, email);
    const write = persist(vault, context),
      approved = commitPreparedAccountMail(context, write);
    assert.equal(approved.approval.sequence, 1);
    assert(ownerHasErasureApproval(vault, context.accountId));
    assert.equal(records(directory).length, 1);
    assert.deepEqual(readFileSync(path.join(directory, other)), bytes);
    assert.deepEqual(accountMailCleanupPending(context), { pending: 0 });
    assert.equal(
      resolvePreparedAccountMail(context, () => "absent", {
        withdrawImmediately: true,
      }),
      "approved",
    );
    assert.throws(
      () => enqueueMail(message(context.accountId)),
      MailUnavailable,
    );
    assert.throws(() => enqueueMail(message()), MailUnavailable);
    enqueueMail(message("new-owner-B"));
    assert.deepEqual(
      commitPreparedAccountMail(context, write).approval,
      approved.approval,
    );
    assert.equal(mailOutboxStatus().pending, 2);
    assert(
      !readFileSync(path.join(directory, "outbox.sqlite")).includes(
        Buffer.from(email),
      ),
    );
    const db = new Database(path.join(directory, "outbox.sqlite"));
    try {
      assert.throws(
        () => db.prepare("DELETE FROM account_mail_suppressions").run(),
        /retained/,
      );
      assert.throws(
        () =>
          db
            .prepare("UPDATE account_mail_suppressions SET state='preparing'")
            .run(),
        /withdrawn/,
      );
    } finally {
      db.close();
    }
  }));

test("crash after private approval and before mail activation retains a dispatch hold until verified recovery", () =>
  fixture((context, vault, directory) => {
    enqueueMail(message(context.accountId));
    prepareAccountMail(context, email);
    const file = path.join(directory, records(directory)[0]),
      bytes = readFileSync(file),
      write = persist(vault, context);
    assert.throws(
      () =>
        commitPreparedAccountMail(context, () => {
          write();
          throw new Error("Simulated interruption before activation");
        }),
      MailUnavailable,
    );
    assert(ownerHasErasureApproval(vault, context.accountId));
    assert.deepEqual(readFileSync(file), bytes);
    assert.equal(claimMail(), undefined);
    assert.equal(
      resolvePreparedAccountMail(context, () => {
        approvedErasureContext(
          vault,
          context.requestId,
          context.accountId,
          context.workspaceId,
        );
        return "approved";
      }),
      "approved",
    );
    assert.equal(records(directory).length, 0);
    assert.deepEqual(accountMailCleanupPending(context), { pending: 0 });
    assert.equal(pendingAccountMailPreparations().length, 0);
  }));

test("an absent journal approval can withdraw a preparation after its grace period without losing queued links", () =>
  fixture((context, vault, directory) => {
    enqueueMail(message(context.accountId));
    prepareAccountMail(context, email);
    const file = path.join(directory, records(directory)[0]),
      bytes = readFileSync(file);
    assert.throws(
      () =>
        commitPreparedAccountMail(context, () => {
          throw new Error("Synthetic journal failure before approval");
        }),
      MailUnavailable,
    );
    assert(!ownerHasErasureApproval(vault, context.accountId));
    assert.equal(
      resolvePreparedAccountMail(context, () => "absent"),
      "preparing",
    );
    assert.equal(
      resolvePreparedAccountMail(context, () => "absent", {
        now: Date.now() + 31000,
      }),
      "withdrawn",
    );
    assert.deepEqual(readFileSync(file), bytes);
    assert(claimMail());
  }));

test("captured sends remain leased through erasure and a failed in-flight send never becomes a new retry", () =>
  fixture((context, vault, directory) => {
    enqueueMail(message(context.accountId));
    const send = claimMail()!;
    prepareAccountMail(context, email);
    commitPreparedAccountMail(context, persist(vault, context));
    assert.equal(records(directory).length, 1);
    assert.deepEqual(accountMailCleanupPending(context), { pending: 1 });
    assert.equal(mailOutboxStatus().leased, 1);
    assert.equal(mailOutboxStatus().suppressed, 1);
    assert.equal(claimMail(), undefined);
    assert(settleMail(send, false));
    assert.equal(records(directory).length, 0);
    assert.deepEqual(accountMailCleanupPending(context), { pending: 0 });
  }));

test("missing suppression keys fail closed instead of silently changing legacy email fingerprints", () =>
  fixture((context, vault, directory) => {
    enqueueMail(message(context.accountId));
    prepareAccountMail(context, email);
    commitPreparedAccountMail(context, persist(vault, context));
    const key = path.join(directory, "suppression-key.json");
    rmSync(key);
    assert.throws(() => enqueueMail(message()), MailUnavailable);
    assert.equal(existsSync(key), false);
  }));
