import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, readFile, stat, access, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { enqueueMail } from "../src/lib/mail-outbox";
async function stop(child: ChildProcess) {
  if (child.exitCode !== null || child.signalCode) return;
  const closed = new Promise<void>((resolve) =>
    child.once("close", () => resolve()),
  );
  child.kill("SIGTERM");
  const timer = setTimeout(() => child.kill("SIGKILL"), 5000);
  try {
    await closed;
  } finally {
    clearTimeout(timer);
  }
}
test(
  "fake mail consumer excludes duplicates, recovers SIGKILL on the same permanent inode and never invokes SMTP",
  { skip: process.platform !== "linux", timeout: 30000 },
  async () => {
    const root = await mkdtemp(path.join(tmpdir(), "reelchemy-mail-kernel-")),
      children: ChildProcess[] = [],
      receipt = path.join(root, "synthetic-receipt"),
      saved = process.env.REELCHEMY_AUTH_DIR;
    const start = () => {
      const child = spawn(
        process.execPath,
        ["--import", "tsx", "tests/helpers/mail-fake-entrypoint.ts"],
        {
          env: {
            ...process.env,
            REELCHEMY_AUTH_DIR: root,
            MAIL_TEST_RECEIPT: receipt,
          },
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
      children.push(child);
      let errors = "";
      child.stderr!.on("data", (data) => {
        errors += data.toString().slice(0, 2000);
      });
      child.stdout!.resume();
      return { child, errors: () => errors };
    };
    const ready = async (
      worker: ReturnType<typeof start>,
      previous?: string,
    ) => {
      const end = Date.now() + 10000;
      while (Date.now() < end) {
        if (worker.child.exitCode !== null || worker.child.signalCode)
          throw new Error(worker.errors() || "Fake mail consumer exited.");
        try {
          const value = JSON.parse(
            await readFile(path.join(root, "mail", "heartbeat.json"), "utf8"),
          );
          if (value.ready && value.instanceId !== previous)
            return value as { instanceId: string; pid: number };
        } catch {}
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      throw new Error("Fake mail consumer did not become ready.");
    };
    try {
      const first = start(),
        identity = await ready(first),
        lock = path.join(root, "mail", "worker.lifecycle.lock"),
        inode = (await stat(lock)).ino;
      const duplicate = start();
      assert.equal(
        await new Promise((resolve) => duplicate.child.once("close", resolve)),
        1,
      );
      assert.match(duplicate.errors(), /Another mail worker/);
      assert.equal((await ready(first)).instanceId, identity.instanceId);
      const crashed = new Promise((resolve) =>
        first.child.once("close", resolve),
      );
      process.kill(identity.pid, "SIGKILL");
      await crashed;
      await access(path.join(root, "mail", "worker.lock"));
      const replacement = start();
      const recovered = await ready(replacement, identity.instanceId);
      assert.notEqual(recovered.instanceId, identity.instanceId);
      assert.equal((await stat(lock)).ino, inode);
      process.env.REELCHEMY_AUTH_DIR = root;
      enqueueMail({
        to: "fake-maker@example.test",
        subject: "Synthetic account",
        text: "Never send this message over SMTP",
      });
      const end = Date.now() + 5000;
      while (Date.now() < end) {
        try {
          if ((await readFile(receipt, "utf8")) === "fake-delivery\n") break;
        } catch {}
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      assert.equal(await readFile(receipt, "utf8"), "fake-delivery\n");
      await stop(replacement.child);
      await assert.rejects(() =>
        access(path.join(root, "mail", "worker.lock")),
      );
      await assert.rejects(() =>
        access(path.join(root, "mail", "heartbeat.json")),
      );
      assert.equal((await stat(lock)).ino, inode);
    } finally {
      await Promise.all(children.map(stop));
      if (saved === undefined) delete process.env.REELCHEMY_AUTH_DIR;
      else process.env.REELCHEMY_AUTH_DIR = saved;
      await rm(root, { recursive: true, force: true });
    }
  },
);
