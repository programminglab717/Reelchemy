import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  rm,
  lstat,
  symlink,
  readdir,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { once } from "node:events";
import {
  spawnTestProcess,
  shutdownTestProcesses,
} from "../scripts/test-process";
import {
  renderJobMarker,
  renderRootMarker,
} from "../src/lib/render-attempt-processes";
const script = path.resolve("scripts/export-storage-census.ts"),
  hash = (b: Buffer) => createHash("sha256").update(b).digest("hex");
async function command(args: string[]) {
  const child = spawnTestProcess(
    process.execPath,
    ["--import", "tsx", script, ...args],
    { env: { ...process.env }, stdio: ["ignore", "pipe", "pipe"] },
  );
  let output = "";
  for (const stream of [child.stdout, child.stderr])
    stream?.on("data", (bytes) => {
      output = (output + bytes).slice(-32768);
    });
  try {
    const code = await new Promise<number>((resolve, reject) => {
      child.once("error", reject);
      child.once("close", (code) => resolve(code ?? 1));
    });
    return { code, output };
  } finally {
    await shutdownTestProcesses([child]);
  }
}
async function fixture(
  run: (f: {
    data: string;
    artifacts: string;
    file: string;
    jobId: string;
    args: string[];
  }) => Promise<void>,
) {
  const root = await mkdtemp(path.join(tmpdir(), "reelchemy-export-cli-")),
    data = path.join(root, "owner's ; $studio"),
    artifacts = path.join(root, "exports"),
    jobId = randomUUID(),
    projectId = randomUUID();
  await mkdir(data);
  await mkdir(path.join(artifacts, jobId), { recursive: true });
  await writeFile(path.join(artifacts, jobId, "video.mp4"), "OWNED");
  const file = path.join(data, "studio.sqlite"),
    db = new Database(file);
  db.exec(
    "CREATE TABLE projects(id TEXT PRIMARY KEY,data TEXT,workspace_id TEXT,trashed_at TEXT);CREATE TABLE jobs(id TEXT PRIMARY KEY,project_id TEXT,status TEXT,data TEXT,timeline TEXT);CREATE TABLE project_deletions(project_id TEXT);CREATE TABLE render_job_attempts(job_id TEXT PRIMARY KEY,started_at TEXT)",
  );
  db.prepare("INSERT INTO projects VALUES(?,?,'studio',NULL)").run(
    projectId,
    JSON.stringify({ private: "PRIVATE_PROJECT_CANARY" }),
  );
  db.prepare("INSERT INTO jobs VALUES(?,?,'completed',?,?)").run(
    jobId,
    projectId,
    JSON.stringify({ private: "PRIVATE_JOB_CANARY" }),
    "{}",
  );
  db.close();
  try {
    await run({
      data,
      artifacts,
      file,
      jobId,
      args: ["--data", data, "--artifacts", artifacts],
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
test("census CLI requires explicit storage paths before opening or initializing a database", async () => {
  const result = await command([]);
  assert.equal(result.code, 1);
  assert.match(result.output, /required|Usage/);
});
test("an empty or account-only data path is refused before creating lifecycle files", async () => {
  const root = await mkdtemp(
    path.join(tmpdir(), "reelchemy-export-wrong-root-"),
  );
  try {
    const data = path.join(root, "private-accounts"),
      artifacts = path.join(root, "exports");
    await mkdir(data);
    await mkdir(artifacts);
    await writeFile(path.join(data, "auth.sqlite"), "private fixture");
    const result = await command(["--data", data, "--artifacts", artifacts]);
    assert.equal(result.code, 1);
    assert.deepEqual(await readdir(data), ["auth.sqlite"]);
    assert.deepEqual(await readdir(artifacts), []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test("operator recount handles literal path metacharacters, retains source content and both lifetime inodes, and emits only aggregate metadata", async () =>
  fixture(async (f) => {
    const source = await readFile(path.join(f.artifacts, f.jobId, "video.mp4")),
      result = await command(f.args);
    assert.equal(result.code, 0, result.output);
    assert(
      !/PRIVATE_PROJECT_CANARY|PRIVATE_JOB_CANARY|owner's/.test(result.output),
    );
    assert(result.output.includes('"bytes":5'));
    let db = new Database(f.file);
    assert.equal(
      (
        db
          .prepare(
            "SELECT retained_bytes FROM export_storage_entries WHERE job_id=?",
          )
          .get(f.jobId) as { retained_bytes: number }
      ).retained_bytes,
      5,
    );
    assert(
      (
        db.prepare("SELECT data FROM projects").get() as { data: string }
      ).data.includes("PRIVATE_PROJECT_CANARY"),
    );
    db.close();
    const before = await Promise.all(
      ["worker.lifecycle.lock", "ingest.lifecycle.lock"].map((n) =>
        lstat(path.join(f.data, n)),
      ),
    );
    const again = await command(f.args);
    assert.equal(again.code, 0, again.output);
    const after = await Promise.all(
      ["worker.lifecycle.lock", "ingest.lifecycle.lock"].map((n) =>
        lstat(path.join(f.data, n)),
      ),
    );
    for (let i = 0; i < 2; i++) {
      assert.equal(before[i].ino, after[i].ino);
      assert.equal(after[i].mode & 0o777, 0o600);
    }
    assert.equal(
      hash(await readFile(path.join(f.artifacts, f.jobId, "video.mp4"))),
      hash(source),
    );
    await assert.rejects(lstat(path.join(f.data, "auth.sqlite")), {
      code: "ENOENT",
    });
    db = new Database(f.file);
    assert(
      (
        db.prepare("SELECT data FROM jobs").get() as { data: string }
      ).data.includes("PRIVATE_JOB_CANARY"),
    );
    db.close();
  }));
for (const lock of ["worker.lifecycle.lock", "ingest.lifecycle.lock"])
  test(`recount refuses a held ${lock} before any database migration`, async () =>
    fixture(async (f) => {
      await writeFile(path.join(f.data, lock), "", { mode: 0o600 });
      const holder = spawnTestProcess(
        "flock",
        [
          "--nonblock",
          "--no-fork",
          path.join(f.data, lock),
          process.execPath,
          "-e",
          "process.stdout.write('ready\\n');setInterval(()=>{},1000)",
        ],
        { env: { ...process.env }, stdio: ["ignore", "pipe", "pipe"] },
      );
      try {
        await once(holder.stdout!, "data");
        const before = hash(await readFile(f.file)),
          result = await command(f.args);
        assert.equal(result.code, 73, result.output);
        assert.match(result.output, /locks are still held/);
        assert.equal(hash(await readFile(f.file)), before);
        const db = new Database(f.file);
        assert.equal(
          db
            .prepare(
              "SELECT 1 FROM sqlite_master WHERE name='export_storage_entries'",
            )
            .get(),
          undefined,
        );
        db.close();
      } finally {
        await shutdownTestProcesses([holder]);
      }
    }));
test("stale diagnostics are preserved instead of being removed to force a recount", async () =>
  fixture(async (f) => {
    await writeFile(path.join(f.data, "worker.lock"), "fixture-diagnostic");
    const before = hash(await readFile(f.file)),
      result = await command(f.args);
    assert.equal(result.code, 1);
    assert.match(result.output, /review any stale diagnostics/);
    assert.equal(
      await readFile(path.join(f.data, "worker.lock"), "utf8"),
      "fixture-diagnostic",
    );
    assert.equal(hash(await readFile(f.file)), before);
  }));
test("a live marked orphan under the configured data alias blocks recount without exposing or changing content", async () =>
  fixture(async (f) => {
    const alias = f.data + "-alias";
    await symlink(f.data, alias);
    const child = spawnTestProcess(
      process.execPath,
      ["-e", "process.stdout.write('ready\\n');setInterval(()=>{},1000)"],
      {
        env: {
          ...process.env,
          [renderJobMarker]: f.jobId,
          [renderRootMarker]: alias,
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    try {
      await once(child.stdout!, "data");
      const before = hash(await readFile(f.file)),
        result = await command(["--data", alias, "--artifacts", f.artifacts]);
      assert.equal(result.code, 1, result.output);
      assert.match(result.output, /interrupted native render is still active/);
      assert.equal(hash(await readFile(f.file)), before);
    } finally {
      await shutdownTestProcesses([child]);
    }
  }));
