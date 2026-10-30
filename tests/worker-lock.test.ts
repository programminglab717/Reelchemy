import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import {
  mkdtemp,
  readFile,
  writeFile,
  access,
  rm,
  stat,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
async function stop(child: ChildProcess) {
  if (child.exitCode !== null || child.signalCode) return;
  const closed = new Promise<void>((resolve) =>
    child.once("close", () => resolve()),
  );
  child.kill("SIGTERM");
  const timer = setTimeout(() => child.kill("SIGKILL"), 12000);
  try {
    await closed;
  } finally {
    clearTimeout(timer);
  }
}
function start(dir: string) {
  const child = spawn(
    process.execPath,
    ["--import", "tsx", "scripts/worker-entrypoint.ts"],
    {
      env: {
        ...process.env,
        NODE_ENV: "production",
        REELCHEMY_DATA_DIR: dir,
        REELCHEMY_ARTIFACT_DIR: path.join(dir, "artifacts"),
        AI_PROVIDER: "mock",
      },
      stdio: ["ignore", "ignore", "pipe"],
    },
  );
  let errors = "";
  child.stderr.on("data", (value) => {
    errors += value.toString().slice(0, 4000);
  });
  return { child, errors: () => errors };
}
async function ready(
  dir: string,
  worker: ReturnType<typeof start>,
  previous?: string,
) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (worker.child.exitCode !== null || worker.child.signalCode)
      throw new Error(worker.errors() || "Worker exited before readiness.");
    try {
      const lock = JSON.parse(
        await readFile(path.join(dir, "worker.lock"), "utf8"),
      );
      const heartbeat = JSON.parse(
        await readFile(path.join(dir, "worker-heartbeat.json"), "utf8"),
      );
      if (
        lock.instanceId !== previous &&
        heartbeat.instanceId === lock.instanceId
      )
        return lock as { pid: number; instanceId: string; kind: string };
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Worker did not publish its managed lock/heartbeat.");
}
test(
  "kernel lifecycle lock rejects duplicates, recovers a hard crash and cleans diagnostics on shutdown",
  { skip: process.platform !== "linux", timeout: 45000 },
  async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "reelchemy-kernel-lock-")),
      workers: ChildProcess[] = [];
    try {
      const first = start(dir);
      workers.push(first.child);
      const original = await ready(dir, first);
      assert.equal(original.kind, "reelchemy-worker-lock-v2");
      assert.equal(
        (await stat(path.join(dir, "worker.lifecycle.lock"))).mode & 0o777,
        0o600,
      );
      const duplicate = start(dir);
      workers.push(duplicate.child);
      const rejected = await new Promise<number | null>((resolve) =>
        duplicate.child.once("close", resolve),
      );
      assert.equal(rejected, 1);
      assert.match(duplicate.errors(), /Another render worker/);
      assert.equal(
        JSON.parse(await readFile(path.join(dir, "worker.lock"), "utf8"))
          .instanceId,
        original.instanceId,
      );
      const crashed = new Promise<void>((resolve) =>
        first.child.once("close", () => resolve()),
      );
      process.kill(original.pid, "SIGKILL");
      await crashed;
      await access(path.join(dir, "worker.lock")); // Crash left diagnostics, not a held kernel lock.
      const replacement = start(dir);
      workers.push(replacement.child);
      const recovered = await ready(dir, replacement, original.instanceId);
      assert.notEqual(recovered.instanceId, original.instanceId);
      await stop(replacement.child);
      await assert.rejects(() => access(path.join(dir, "worker.lock")));
      await assert.rejects(() =>
        access(path.join(dir, "worker-heartbeat.json")),
      );
      await access(path.join(dir, "worker.lifecycle.lock")); // Keep the coordination inode.
    } finally {
      await Promise.all(workers.map(stop));
      await rm(dir, { recursive: true, force: true });
    }
  },
);
test(
  "managed startup does not steal the lock of a live legacy worker",
  { skip: process.platform !== "linux", timeout: 20000 },
  async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "reelchemy-legacy-lock-"));
    let child: ChildProcess | undefined;
    try {
      await writeFile(path.join(dir, "worker.lock"), String(process.pid));
      const worker = start(dir);
      child = worker.child;
      assert.equal(
        await new Promise((resolve) => child!.once("close", resolve)),
        1,
      );
      assert.match(worker.errors(), /legacy worker PID is still running/);
      assert.equal(
        await readFile(path.join(dir, "worker.lock"), "utf8"),
        String(process.pid),
      );
    } finally {
      if (child) await stop(child);
      await rm(dir, { recursive: true, force: true });
    }
  },
);
