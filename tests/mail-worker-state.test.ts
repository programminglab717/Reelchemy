import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  rmSync,
  readFileSync,
  writeFileSync,
  existsSync,
} from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { tmpdir } from "node:os";
import {
  startMailWorkerState,
  heartbeatMailWorker,
  stopMailWorkerState,
  mailWorkerHealthy,
} from "../src/lib/mail-worker-state";
import { enqueueMail } from "../src/lib/mail-outbox";
import { MailUnavailable } from "../src/lib/mail-policy";
test("private mail health binds current instance and PID start identity, rejects stale/future/blocked states and preserves ownership", () => {
  const root = mkdtempSync(path.join(tmpdir(), "reelchemy-mail-health-")),
    saved = process.env.REELCHEMY_AUTH_DIR;
  process.env.REELCHEMY_AUTH_DIR = root;
  try {
    const identity = startMailWorkerState(),
      file = path.join(root, "mail", "heartbeat.json");
    assert.equal(mailWorkerHealthy(), false);
    heartbeatMailWorker(identity, true);
    assert.equal(mailWorkerHealthy(), true);
    const valid = JSON.parse(readFileSync(file, "utf8"));
    for (const patch of [
      { ready: false },
      { ready: "true" },
      { updatedAt: new Date(Date.now() - 21000).toISOString() },
      { updatedAt: new Date(Date.now() + 3000).toISOString() },
      { instanceId: randomUUID() },
      { started: "0" },
    ]) {
      writeFileSync(file, JSON.stringify({ ...valid, ...patch }));
      assert.equal(mailWorkerHealthy(), false);
    }
    assert.throws(
      () => stopMailWorkerState({ ...identity, instanceId: randomUUID() }),
      MailUnavailable,
    );
    assert(existsSync(path.join(root, "mail", "worker.lock")));
    heartbeatMailWorker(identity, true);
    stopMailWorkerState(identity);
    assert.equal(mailWorkerHealthy(), false);
    assert(!existsSync(file));
    assert(existsSync(path.join(root, "mail", "outbox.sqlite")));
  } finally {
    if (saved === undefined) delete process.env.REELCHEMY_AUTH_DIR;
    else process.env.REELCHEMY_AUTH_DIR = saved;
    rmSync(root, { recursive: true, force: true });
  }
});
test("live legacy mail PID is refused without deleting its diagnostic or pending private mail", () => {
  const root = mkdtempSync(path.join(tmpdir(), "reelchemy-mail-legacy-")),
    saved = process.env.REELCHEMY_AUTH_DIR;
  process.env.REELCHEMY_AUTH_DIR = root;
  try {
    enqueueMail({
      to: "legacy@example.test",
      subject: "Verify",
      text: "Synthetic legacy URL",
    });
    const file = path.join(root, "mail", "worker.lock");
    writeFileSync(file, String(process.pid));
    assert.throws(() => startMailWorkerState(), MailUnavailable);
    assert.equal(readFileSync(file, "utf8"), String(process.pid));
  } finally {
    if (saved === undefined) delete process.env.REELCHEMY_AUTH_DIR;
    else process.env.REELCHEMY_AUTH_DIR = saved;
    rmSync(root, { recursive: true, force: true });
  }
});
