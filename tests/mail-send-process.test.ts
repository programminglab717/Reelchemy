import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { readFileSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import {
  sendMailProcess,
  SMTP_SEND_DEADLINE_MS,
} from "../src/lib/mail-send-process";
import { MailUnavailable } from "../src/lib/mail-policy";
const mail = {
  to: "synthetic@example.test",
  subject: "Synthetic sender fixture",
  text: "Private Unicode fixture 🎬 — never sent externally",
};

test(
  "isolated fake SMTP sender receives bounded pipe data and only mail-specific credentials; transport errors stay fixed",
  { timeout: 15000 },
  async () => {
    const root = await mkdtemp(path.join(tmpdir(), "reelchemy-mail-send-")),
      script = path.join(root, "fake.cjs"),
      record = path.join(root, "record.json");
    const keys = [
        "BETTER_AUTH_SECRET",
        "AI_API_KEY",
        "SMTP_PASSWORD",
        "REELCHEMY_AUTH_DIR",
      ] as const,
      saved = keys.map((key) => process.env[key]);
    process.env.BETTER_AUTH_SECRET = "synthetic-auth-secret";
    process.env.AI_API_KEY = "synthetic-ai-secret";
    process.env.SMTP_PASSWORD = "synthetic-smtp-secret";
    process.env.REELCHEMY_AUTH_DIR = root;
    try {
      await writeFile(
        script,
        `const fs=require('node:fs'),crypto=require('node:crypto');let input='';process.stdin.on('data',chunk=>input+=chunk);process.stdin.on('end',()=>{fs.writeFileSync(${JSON.stringify(record)},JSON.stringify({hash:crypto.createHash('sha256').update(input).digest('hex'),auth:'BETTER_AUTH_SECRET' in process.env,ai:'AI_API_KEY' in process.env,authRoot:'REELCHEMY_AUTH_DIR' in process.env,smtp:process.env.SMTP_PASSWORD==='synthetic-smtp-secret',tlsOverride:'NODE_TLS_REJECT_UNAUTHORIZED' in process.env}));process.stdout.write('sent\\n');});`,
      );
      await sendMailProcess(
        { ...mail, accountId: "private-account-id-not-needed-by-transport" },
        { executable: script, deadlineMs: 5000 },
      );
      const proof = JSON.parse(await readFile(record, "utf8"));
      assert.deepEqual(proof, {
        hash: createHash("sha256").update(JSON.stringify(mail)).digest("hex"),
        auth: false,
        ai: false,
        authRoot: false,
        smtp: true,
        tlsOverride: false,
      });
      await writeFile(
        script,
        "process.stderr.write('Synthetic private URL https://private.example.test/secret');process.exit(2);",
      );
      await assert.rejects(
        () => sendMailProcess(mail, { executable: script, deadlineMs: 5000 }),
        (error) =>
          error instanceof MailUnavailable &&
          !error.message.includes("private.example.test"),
      );
      await writeFile(
        script,
        "process.stdout.write('unexpected private data');",
      );
      await assert.rejects(
        () => sendMailProcess(mail, { executable: script, deadlineMs: 5000 }),
        MailUnavailable,
      );
      assert.equal(SMTP_SEND_DEADLINE_MS, 45000);
    } finally {
      keys.forEach((key, index) => {
        if (saved[index] === undefined) delete process.env[key];
        else process.env[key] = saved[index];
      });
      await rm(root, { recursive: true, force: true });
    }
  },
);

test(
  "uncooperative fake sender is killed and reaped before a failed send can return",
  { timeout: 15000 },
  async () => {
    const root = await mkdtemp(
        path.join(tmpdir(), "reelchemy-mail-send-timeout-"),
      ),
      script = path.join(root, "fake.cjs"),
      pidFile = path.join(root, "pid");
    try {
      await writeFile(
        script,
        `require('node:fs').writeFileSync(${JSON.stringify(pidFile)},String(process.pid));process.on('SIGTERM',()=>{});process.stdin.resume();setInterval(()=>{},1000);`,
      );
      const before = Date.now();
      await assert.rejects(
        () => sendMailProcess(mail, { executable: script, deadlineMs: 1000 }),
        MailUnavailable,
      );
      assert(Date.now() - before < 8000);
      const pid = Number(await readFile(pidFile, "utf8"));
      let executing = false;
      try {
        const state = readFileSync(`/proc/${pid}/stat`, "utf8")
          .split(") ")[1]
          .split(" ")[0];
        executing = !["Z", "X"].includes(state);
      } catch (error) {
        assert.equal((error as NodeJS.ErrnoException).code, "ENOENT");
      }
      assert.equal(
        executing,
        false,
        "The failed send must await native process closure before retry admission.",
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);
