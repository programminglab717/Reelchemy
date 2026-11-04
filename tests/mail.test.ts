import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { deliverMail, flushOutbox, mailDir, mailConfig } from "../src/lib/mail";
process.env.REELCHEMY_DATA_DIR = await mkdtemp(
  path.join(tmpdir(), "reelchemy-mail-test-"),
);
test("private mail outbox persists delivery, retries failures, and does not call SMTP at request time", async () => {
  await deliverMail({
    to: "test@example.test",
    subject: "Verify",
    text: "Test-only private URL",
  });
  const files = (await readdir(mailDir())).filter((f) => f.endsWith(".json"));
  assert.equal(files.length, 1);
  assert.deepEqual(
    await flushOutbox(async () => {
      throw new Error("Unavailable");
    }),
    { sent: 0, failed: 1 },
  );
  const item = JSON.parse(
    await readFile(path.join(mailDir(), files[0]), "utf8"),
  );
  assert.equal(item.attempts, 1);
  assert(item.nextAttemptAt > Date.now());
  await deliverMail({
    to: "second@example.test",
    subject: "Reset",
    text: "Another test-only link",
  });
  const result = await flushOutbox(async (message) => {
    assert.equal(message.to, "second@example.test");
  });
  assert.equal(result.sent, 1);
});
test("production refuses file mail delivery", () => {
  assert.throws(
    () => mailConfig({ NODE_ENV: "production", EMAIL_DELIVERY: "file" }),
    /disabled in production/,
  );
});

test("SMTP configuration validates ports/headers without connecting to a transport", () => {
  const valid = {
    NODE_ENV: "production",
    EMAIL_DELIVERY: "smtp",
    SMTP_HOST: "smtp.example.test",
    EMAIL_FROM: "Reelchemy <studio@example.test>",
  };
  assert.equal(mailConfig(valid), "smtp");
  assert.equal(
    mailConfig({ ...valid, SMTP_HOST: "::1", SMTP_PORT: "465" }),
    "smtp",
  );
  for (const SMTP_PORT of ["0", "-1", "65536", "587.5", " 587", "5e2"])
    assert.throws(() => mailConfig({ ...valid, SMTP_PORT }));
  for (const SMTP_HOST of [
    "smtp.example.test\nSECRET",
    " ",
    "https://smtp.example.test",
  ])
    assert.throws(() => mailConfig({ ...valid, SMTP_HOST }));
  assert.throws(() =>
    mailConfig({
      ...valid,
      EMAIL_FROM: "studio@example.test\r\nBcc:other@example.test",
    }),
  );
});
