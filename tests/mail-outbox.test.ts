import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
  lstatSync,
  symlinkSync,
  linkSync,
  mkdirSync,
  rmSync,
} from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import {
  enqueueMail,
  claimMail,
  settleMail,
  mailOutboxStatus,
} from "../src/lib/mail-outbox";
import { flushOutbox, mailDir } from "../src/lib/mail";
import {
  mailPolicy,
  MailCapacity,
  MailUnavailable,
  MAIL_LEASE_MS,
  MAIL_LIFETIME_MS,
} from "../src/lib/mail-policy";
const message = (
  to = "maker@example.test",
  text = "Synthetic verification URL",
) => ({ to, subject: "Verify account", text });
async function fixture(run: (root: string) => void | Promise<void>) {
  const root = mkdtempSync(path.join(tmpdir(), "reelchemy-mail-outbox-"));
  const keys = [
    "REELCHEMY_AUTH_DIR",
    "REELCHEMY_MAIL_PENDING_COUNT",
    "REELCHEMY_MAIL_PENDING_BYTES",
  ] as const;
  const saved = keys.map((key) => process.env[key]);
  process.env.REELCHEMY_AUTH_DIR = root;
  delete process.env.REELCHEMY_MAIL_PENDING_COUNT;
  delete process.env.REELCHEMY_MAIL_PENDING_BYTES;
  try {
    await run(root);
  } finally {
    keys.forEach((key, index) => {
      if (saved[index] === undefined) delete process.env[key];
      else process.env[key] = saved[index];
    });
    rmSync(root, { recursive: true, force: true });
  }
}
function files() {
  return readdirSync(mailDir()).filter(
    (name) => name.endsWith(".json") && name !== "heartbeat.json",
  );
}

test("mail policy refuses malformed/unbounded configuration and secret-bearing headers", async () => {
  assert.deepEqual(mailPolicy({}), { count: 1000, bytes: 16777216 });
  for (const value of [
    "0",
    "-1",
    "2001",
    "1.5",
    "1e3",
    " 10",
    "9007199254740993",
  ])
    assert.throws(
      () => mailPolicy({ REELCHEMY_MAIL_PENDING_COUNT: value }),
      MailUnavailable,
    );
  assert.throws(
    () => mailPolicy({ REELCHEMY_MAIL_PENDING_BYTES: "65535" }),
    MailUnavailable,
  );
  await fixture(() => {
    for (const invalid of [
      { ...message(), to: "maker@example.test\r\nBcc: other@example.test" },
      { ...message(), subject: "secret\nsubject" },
      message(undefined, "\0"),
      message(undefined, "a".repeat(32769)),
    ])
      assert.throws(() => enqueueMail(invalid), MailUnavailable);
    assert.equal(readdirSync(process.env.REELCHEMY_AUTH_DIR!).length, 0);
  });
});

test("mail admission serializes count/UTF-8 byte and recipient limits while reserving lease growth", async () => {
  await fixture(() => {
    process.env.REELCHEMY_MAIL_PENDING_COUNT = "2";
    enqueueMail(message("one@example.test"));
    enqueueMail(message("two@example.test"));
    const full = mailOutboxStatus();
    assert.equal(full.pending, 2);
    assert.throws(
      () => enqueueMail(message("three@example.test")),
      MailCapacity,
    );
    const claim = claimMail()!;
    assert.equal(mailOutboxStatus().bytes, full.bytes);
    assert.equal(
      lstatSync(path.join(mailDir(), claim.name)).mode & 0o777,
      0o600,
    );
    assert.equal(
      lstatSync(path.join(mailDir(), "outbox.sqlite")).mode & 0o777,
      0o600,
    );
    assert(settleMail(claim, true));
    enqueueMail(message("three@example.test"));
    assert.equal(mailOutboxStatus().pending, 2);
  });
  await fixture(() => {
    process.env.REELCHEMY_MAIL_PENDING_BYTES = "65536";
    enqueueMail(message("one@example.test", "é".repeat(16000)));
    enqueueMail(message("two@example.test", "é".repeat(16000)));
    assert.throws(
      () => enqueueMail(message("three@example.test", "é".repeat(16000))),
      MailCapacity,
    );
    const full = mailOutboxStatus();
    assert(full.bytes <= 65536);
    const first = claimMail()!;
    assert.equal(mailOutboxStatus().bytes, full.bytes);
    assert(settleMail(first, false));
    assert.equal(mailOutboxStatus().bytes, full.bytes);
  });
  await fixture(() => {
    for (let index = 0; index < 5; index++) enqueueMail(message());
    assert.throws(
      () => enqueueMail(message("MAKER@example.test")),
      MailCapacity,
    );
    enqueueMail(message("different@example.test"));
    assert.equal(mailOutboxStatus().pending, 6);
  });
});

test("concurrent fake delivery cannot send a live leased message twice", async () => {
  await fixture(async () => {
    enqueueMail(message());
    let release!: () => void,
      entered!: () => void,
      calls = 0;
    const ready = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    const first = flushOutbox(async (mail) => {
      assert.equal(mail.to, "maker@example.test");
      calls++;
      entered();
      await hold;
    });
    await ready;
    assert.deepEqual(
      await flushOutbox(async () => {
        calls++;
      }),
      { sent: 0, failed: 0 },
    );
    assert.equal(mailOutboxStatus().leased, 1);
    release();
    assert.deepEqual(await first, { sent: 1, failed: 0 });
    assert.equal(calls, 1);
    assert.equal(files().length, 0);
  });
});

test("a hard crash consumes an attempt; expired claims recover and stale acknowledgements cannot delete a replacement", async () => {
  await fixture(() => {
    enqueueMail(message());
    const start = Date.now(),
      first = claimMail(start)!;
    assert.equal(claimMail(start + MAIL_LEASE_MS - 1), undefined);
    const replacement = claimMail(start + MAIL_LEASE_MS + 1)!;
    assert.notEqual(replacement.token, first.token);
    assert.equal(settleMail(first, true, start + MAIL_LEASE_MS + 2), false);
    assert.equal(mailOutboxStatus().pending, 1);
    assert(settleMail(replacement, false, start + MAIL_LEASE_MS + 2));
    assert.equal(
      claimMail(start + MAIL_LEASE_MS + 30001),
      undefined,
      "second attempt has the original exponential backoff",
    );
    let now = start + MAIL_LEASE_MS + 60003;
    for (let attempt = 3; attempt <= 5; attempt++) {
      const claim = claimMail(now)!;
      assert(claim);
      now += MAIL_LEASE_MS + 1;
    }
    assert.equal(claimMail(now), undefined);
    assert.equal(files().length, 0);
    assert.equal(mailOutboxStatus().discarded, 1);
  });
});

test("bounded legacy expiry removes exhausted/private links but preserves valid retry messages and unrelated files", async () => {
  await fixture(() => {
    enqueueMail(message());
    const name = files()[0],
      item = JSON.parse(readFileSync(path.join(mailDir(), name), "utf8"));
    mkdirSync(path.join(mailDir(), "failed"));
    writeFileSync(
      path.join(mailDir(), "failed", name),
      JSON.stringify({ ...item, attempts: 5 }),
    );
    writeFileSync(
      path.join(mailDir(), name),
      JSON.stringify({
        ...item,
        createdAt: new Date(Date.now() - MAIL_LIFETIME_MS - 1).toISOString(),
      }),
    );
    enqueueMail(message("fresh@example.test"));
    assert.equal(files().length, 1);
    assert.equal(readdirSync(path.join(mailDir(), "failed")).length, 0);
    assert.equal(mailOutboxStatus().discarded, 2);
    const sentinel = path.join(mailDir(), "operator-note");
    writeFileSync(sentinel, "keep this private operator record");
    assert.throws(() => claimMail(), MailUnavailable);
    assert.equal(
      readFileSync(sentinel, "utf8"),
      "keep this private operator record",
    );
    assert.equal(files().length, 1);
  });
});

test("malformed, oversized, symlink and hardlink mail are refused before a fake sender or outside file is touched", async () => {
  for (const kind of [
    "malformed",
    "oversized",
    "symlink",
    "hardlink",
    "database-symlink",
    "directory-symlink",
  ]) {
    await fixture(async (root) => {
      const outside = path.join(root, "outside");
      writeFileSync(outside, "outside synthetic secret");
      if (kind === "directory-symlink") {
        const another = path.join(root, "another");
        mkdirSync(another);
        symlinkSync(another, path.join(root, "mail"));
      } else {
        enqueueMail(message());
        const name = files()[0],
          target = path.join(mailDir(), name);
        if (kind === "malformed")
          writeFileSync(target, "{ invalid secret json");
        if (kind === "oversized") writeFileSync(target, "a".repeat(65537));
        if (kind === "symlink" || kind === "hardlink") {
          rmSync(target);
          if (kind === "symlink") symlinkSync(outside, target);
          else linkSync(outside, target);
        }
        if (kind === "database-symlink") {
          rmSync(path.join(mailDir(), "outbox.sqlite"));
          symlinkSync(outside, path.join(mailDir(), "outbox.sqlite"));
        }
      }
      let calls = 0;
      await assert.rejects(
        () =>
          flushOutbox(async () => {
            calls++;
          }),
        MailUnavailable,
      );
      assert.equal(calls, 0);
      assert.equal(readFileSync(outside, "utf8"), "outside synthetic secret");
    });
  }
});

test("mail batches stop at twenty and graceful stop leaves unclaimed records unchanged", async () => {
  await fixture(async () => {
    for (let index = 0; index < 21; index++)
      enqueueMail(message(`maker-${index}@example.test`));
    assert.deepEqual(await flushOutbox(async () => {}), {
      sent: 20,
      failed: 0,
    });
    const remaining = files()[0],
      before = readFileSync(path.join(mailDir(), remaining));
    assert.deepEqual(
      await flushOutbox(
        async () => {
          assert.fail("Stopped consumers may not claim.");
        },
        { shouldStop: () => true },
      ),
      { sent: 0, failed: 0 },
    );
    assert.deepEqual(readFileSync(path.join(mailDir(), remaining)), before);
    assert.deepEqual(await flushOutbox(async () => {}), { sent: 1, failed: 0 });
  });
});

test("mail inspection neither initializes missing storage nor cleans or expires queue files", async () => {
  await fixture((root) => {
    assert.throws(() => mailOutboxStatus(), MailUnavailable);
    assert.deepEqual(readdirSync(root), []);
    enqueueMail(message());
    const name = files()[0],
      file = path.join(mailDir(), name),
      item = JSON.parse(readFileSync(file, "utf8"));
    writeFileSync(
      file,
      JSON.stringify({
        ...item,
        createdAt: new Date(Date.now() - MAIL_LIFETIME_MS - 1).toISOString(),
      }),
    );
    const temporary = path.join(
      mailDir(),
      ".mail-00000000-0000-4000-8000-000000000000.tmp",
    );
    writeFileSync(temporary, "Synthetic incomplete publication");
    const before = readFileSync(file),
      orphan = readFileSync(temporary),
      database = readFileSync(path.join(mailDir(), "outbox.sqlite"));
    const result = mailOutboxStatus();
    assert.equal(result.pending, 1);
    assert.equal(result.due, 0);
    assert.equal(result.discarded, 0);
    assert.deepEqual(readFileSync(file), before);
    assert.deepEqual(readFileSync(temporary), orphan);
    assert.deepEqual(
      readFileSync(path.join(mailDir(), "outbox.sqlite")),
      database,
    );
  });
});
