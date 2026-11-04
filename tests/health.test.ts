import { test } from "node:test";
import assert from "node:assert/strict";
import { recentHeartbeat, HEARTBEAT_NAME } from "../src/lib/worker-heartbeat";
import { mkdtemp, mkdir, readFile, rm, access, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { startMediaWorker } from "./helpers/media-worker";

test("worker heartbeat rejects stale, missing, malformed and implausible future timestamps", () => {
  const now = Date.now();
  for (const value of [
    null,
    {},
    { at: 123 },
    { at: "invalid" },
    { at: new Date(now).toISOString(), ready: false },
    { at: new Date(now).toISOString(), ready: "true" },
    { at: new Date(now - 30001).toISOString() },
    { at: new Date(now + 5001).toISOString() },
  ])
    assert.equal(recentHeartbeat(value, now), false);
  assert(recentHeartbeat({ at: new Date(now).toISOString() }, now));
  assert(
    recentHeartbeat({ at: new Date(now).toISOString(), ready: true }, now),
  );
  assert(recentHeartbeat({ at: new Date(now - 29999).toISOString() }, now));
});
test("real worker readiness follows its heartbeat and graceful shutdown cleans its lock", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "reelchemy-health-"));
  process.env.REELCHEMY_DATA_DIR = dir;
  process.env.REELCHEMY_ARTIFACT_DIR = path.join(dir, "artifacts");
  process.env.REELCHEMY_RENDER_CACHE_DIR = path.join(dir, "cache");
  await mkdir(process.env.REELCHEMY_ARTIFACT_DIR);
  const accounts = path.join(dir, "accounts");
  process.env.REELCHEMY_AUTH_DIR = accounts;
  process.env.EMAIL_DELIVERY = "file";
  const children: ChildProcess[] = [];
  let ingestion: Awaited<ReturnType<typeof startMediaWorker>> | undefined;
  async function stop(child: ChildProcess) {
    if (child.exitCode !== null) return;
    const closed = new Promise<void>((resolve) =>
      child.once("close", () => resolve()),
    );
    child.kill("SIGTERM");
    const timer = setTimeout(() => child.kill("SIGKILL"), 10000);
    try {
      await closed;
    } finally {
      clearTimeout(timer);
    }
  }
  try {
    const { readiness } = await import("../src/lib/health");
    assert.equal((await readiness()).status, "not-ready");
    ingestion = await startMediaWorker();
    const child = spawn(
      process.execPath,
      ["--import", "tsx", "scripts/worker.ts"],
      {
        env: { ...process.env, AI_PROVIDER: "mock" },
        stdio: ["ignore", "ignore", "pipe"],
      },
    );
    children.push(child);
    let errors = "";
    child.stderr?.on("data", (b) => {
      errors += String(b).slice(0, 2000);
    });
    let ready = false;
    for (let i = 0; i < 100; i++) {
      if (child.exitCode !== null) throw new Error(`Worker exited: ${errors}`);
      try {
        if (
          recentHeartbeat(
            JSON.parse(await readFile(path.join(dir, HEARTBEAT_NAME), "utf8")),
          )
        ) {
          ready = true;
          break;
        }
      } catch {}
      await new Promise((r) => setTimeout(r, 100));
    }
    assert(ready, "Worker must publish a fresh heartbeat.");
    assert.equal((await readiness()).status, "ready");
    try {
      await chmod(accounts, 0o500);
      const unavailable = await readiness();
      assert.equal(
        unavailable.checks.authentication,
        true,
        "the initialized account service is still cached",
      );
      assert.equal(
        unavailable.checks.storage,
        false,
        "a separate unwritable account volume fails readiness",
      );
    } finally {
      await chmod(accounts, 0o700);
    }
    assert.equal((await readiness()).status, "ready");
    for (const key of [
      "REELCHEMY_ERASURE_PENDING_COUNT",
      "REELCHEMY_ERASURE_JOURNAL_COUNT",
    ] as const) {
      const saved = process.env[key];
      try {
        process.env[key] = "invalid";
        assert.equal((await readiness()).checks.limits, false);
      } finally {
        if (saved === undefined) delete process.env[key];
        else process.env[key] = saved;
      }
    }
    const previousLimit = process.env.REELCHEMY_WRITES_PER_MINUTE;
    try {
      process.env.REELCHEMY_WRITES_PER_MINUTE = "invalid";
      const unavailable = await readiness();
      assert.equal(unavailable.status, "not-ready");
      assert.equal(unavailable.checks.limits, false);
    } finally {
      if (previousLimit === undefined)
        delete process.env.REELCHEMY_WRITES_PER_MINUTE;
      else process.env.REELCHEMY_WRITES_PER_MINUTE = previousLimit;
    }
    await stop(child);
    assert.equal((await readiness()).checks.worker, false);
    await ingestion.stop();
    assert.equal((await readiness()).checks.ingestion, false);
    await assert.rejects(() => access(path.join(dir, "worker.lock")));
    await assert.rejects(() => access(path.join(dir, HEARTBEAT_NAME)));
  } finally {
    await ingestion?.stop();
    await Promise.all(children.map(stop));
    await rm(dir, { recursive: true, force: true });
  }
});
