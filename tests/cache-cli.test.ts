import { test, after } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  statSync,
  readdirSync,
  utimesSync,
  rmSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { tmpdir } from "node:os";
import { randomUUID, createHash } from "node:crypto";
import {
  spawnTestProcess,
  shutdownTestProcesses,
} from "../scripts/test-process";
const root = mkdtempSync(path.join(tmpdir(), "reelchemy-cache-cli-"));
after(() => rmSync(root, { recursive: true, force: true }));
function fixture() {
  const directory = path.join(root, randomUUID()),
    studio = randomUUID();
  const data = path.join(directory, "data"),
    auth = path.join(directory, "auth"),
    artifacts = path.join(directory, "exports"),
    cache = path.join(directory, "cache");
  for (const p of [data, auth, artifacts]) mkdirSync(p, { recursive: true });
  const entry = path.join(cache, studio, "a".repeat(64));
  mkdirSync(entry, { recursive: true });
  writeFileSync(path.join(entry, "video.mp4"), "Derived clip");
  writeFileSync(path.join(entry, "manifest.json"), "{}");
  const old = (Date.now() - 2 * 86400000) / 1000;
  utimesSync(path.join(entry, "manifest.json"), old, old);
  const canary = path.join(data, "studio.sqlite");
  writeFileSync(
    canary,
    "Source database canary, deliberately not a SQLite database",
  );
  const env = {
    ...process.env,
    REELCHEMY_DATA_DIR: data,
    REELCHEMY_AUTH_DIR: auth,
    REELCHEMY_ARTIFACT_DIR: artifacts,
    REELCHEMY_RENDER_CACHE_DIR: cache,
    REELCHEMY_SCENE_CACHE_DAYS: "1",
    AI_API_KEY: "SYNTHETIC_KEY_MUST_NOT_APPEAR",
    SMTP_PASSWORD: "SYNTHETIC_PASSWORD_MUST_NOT_APPEAR",
  };
  return {
    data,
    cache,
    entry,
    canary,
    env,
    lifecycle: path.join(data, "worker.lifecycle.lock"),
  };
}
function run(env: NodeJS.ProcessEnv, ...args: string[]) {
  return spawnSync(
    process.execPath,
    ["--import", "tsx", "scripts/cache-maintenance.ts", ...args],
    { env, encoding: "utf8", timeout: 15000, maxBuffer: 65536 },
  );
}
function hash(file: string) {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}
async function ready(child: ReturnType<typeof spawnTestProcess>) {
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error("Private lock fixture did not start")),
      5000,
    );
    child.once("error", reject);
    child.stdout!.on("data", (chunk) => {
      if (chunk.toString().includes("READY")) {
        clearTimeout(timeout);
        resolve();
      }
    });
  });
}
test("cache inspection reports aggregate policy/bytes without initializing data, authentication or lifecycle locks", () => {
  const f = fixture(),
    before = hash(f.canary);
  const result = run(f.env);
  assert.equal(result.status, 0, result.stderr);
  const value = JSON.parse(result.stdout);
  assert.equal(value.dryRun, true);
  assert.equal(value.cache.removeEntries, 1);
  assert.equal(existsSync(f.lifecycle), false);
  assert.equal(
    existsSync(path.join(f.cache, ".reelchemy-scene-cache-v1")),
    false,
  );
  assert.equal(existsSync(path.join(f.data, "studio.sqlite-wal")), false);
  assert.equal(hash(f.canary), before);
  assert(!result.stdout.includes(f.entry));
  assert(!result.stdout.includes("SYNTHETIC_"));
  assert.equal(existsSync(f.entry), true);
});
test("explicit maintenance reclaims only derived clips and keeps the existing permanent lifecycle inode", () => {
  const f = fixture(),
    before = hash(f.canary);
  writeFileSync(f.lifecycle, "Permanent inode must remain");
  const inode = statSync(f.lifecycle).ino;
  const result = run(f.env, "--apply");
  assert.equal(result.status, 0, result.stderr);
  const value = JSON.parse(result.stdout);
  assert.equal(value.dryRun, false);
  assert.equal(value.cache.removeEntries, 1);
  assert.equal(value.cache.retainedEntries, 0);
  assert.equal(existsSync(f.entry), false);
  assert.equal(statSync(f.lifecycle).ino, inode);
  assert.equal(
    readFileSync(f.lifecycle, "utf8"),
    "Permanent inode must remain",
  );
  assert.equal(hash(f.canary), before);
  assert(!result.stdout.includes("SYNTHETIC_"));
  assert(!result.stderr.includes("SYNTHETIC_"));
});
test("a live kernel owner refuses maintenance without changing the cache or permanent lock inode", async () => {
  const f = fixture();
  writeFileSync(f.lifecycle, "Keep permanent inode");
  const inode = statSync(f.lifecycle).ino;
  const holder = spawnTestProcess(
    "flock",
    [
      "--no-fork",
      f.lifecycle,
      process.execPath,
      "-e",
      "process.stdout.write('READY\\n');setInterval(()=>{},1000)",
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  try {
    await ready(holder);
    const result = run(f.env, "--apply");
    assert.equal(result.status, 1);
    assert.match(result.stderr, /render process is active/);
    assert.equal(existsSync(f.entry), true);
    const sample = spawnSync(
      process.execPath,
      ["--import", "tsx", "scripts/render-sample.ts"],
      { env: f.env, encoding: "utf8", timeout: 15000, maxBuffer: 65536 },
    );
    assert.equal(sample.status, 1);
    assert.match(sample.stderr, /render process is active/);
    assert.equal(statSync(f.lifecycle).ino, inode);
    assert.equal(readFileSync(f.lifecycle, "utf8"), "Keep permanent inode");
    process.kill(holder.pid!, 0);
  } finally {
    await shutdownTestProcesses([holder]);
  }
});
test("a live legacy PID sentinel is preserved and cannot be bypassed by creating a new kernel lock", async () => {
  const f = fixture();
  const sentinel = spawnTestProcess(
    process.execPath,
    ["-e", "process.stdout.write('READY\\n');setInterval(()=>{},1000)"],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  try {
    await ready(sentinel);
    writeFileSync(path.join(f.data, "worker.lock"), String(sentinel.pid));
    const result = run(f.env, "--apply");
    assert.equal(result.status, 1);
    assert.match(result.stderr, /refused unsafe state/);
    process.kill(sentinel.pid!, 0);
    assert.equal(
      readFileSync(path.join(f.data, "worker.lock"), "utf8"),
      String(sentinel.pid),
    );
    assert.equal(existsSync(f.entry), true);
  } finally {
    await shutdownTestProcesses([sentinel]);
  }
});

test(
  "sample rendering uses the same permanent lock and gracefully cancels private native work",
  { timeout: 110000 },
  async () => {
    const f = fixture(),
      before = hash(f.canary);
    const defaultOutput = path.resolve("artifacts", "sample-60-landscape");
    const existed = existsSync(defaultOutput);
    const producer = spawnTestProcess(
      process.execPath,
      ["--import", "tsx", "scripts/render-sample.ts", "--duration=60"],
      { env: f.env, stdio: ["ignore", "pipe", "pipe"] },
    );
    let errors = "";
    producer.stderr!.on("data", (value) => {
      errors = (errors + value.toString()).slice(-8000);
    });
    try {
      const end = Date.now() + 60000;
      let active = false;
      while (Date.now() < end) {
        if (producer.exitCode !== null || producer.signalCode !== null)
          throw new Error(`Private sample exited before rendering: ${errors}`);
        try {
          active = readdirSync(path.join(f.cache, "local")).some((name) =>
            name.startsWith(".partial-"),
          );
        } catch {
          /* Producer is initializing. */
        }
        if (active) break;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      assert(
        active,
        `Private sample did not reach native cache preparation: ${errors}`,
      );
      const inode = statSync(f.lifecycle).ino;
      const refused = run(f.env, "--apply");
      assert.equal(refused.status, 1);
      assert.match(refused.stderr, /render process is active/);
      const closed = new Promise<void>((resolve) =>
        producer.once("close", () => resolve()),
      );
      producer.kill("SIGTERM");
      await Promise.race([
        closed,
        new Promise((_, reject) => {
          const timer = setTimeout(
            () => reject(new Error("Private sample did not stop gracefully")),
            15000,
          );
          timer.unref();
        }),
      ]);
      assert.equal(
        producer.signalCode,
        null,
        "the parent must forward the signal and wait for its native producer",
      );
      assert.equal(statSync(f.lifecycle).ino, inode);
      assert.equal(hash(f.canary), before);
      assert.equal(existsSync(defaultOutput), existed);
      const entries = existsSync(path.join(f.cache, "local"))
        ? readdirSync(path.join(f.cache, "local"))
        : [];
      assert(!entries.some((name) => name.startsWith(".partial-")));
    } finally {
      await shutdownTestProcesses([producer]);
    }
  },
);
