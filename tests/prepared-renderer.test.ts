import { test, after } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  readdir,
  rm,
  symlink,
  unlink,
  stat,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import {
  RENDERER_DIRECTORY,
  PreparedRendererUnavailable,
  sealPreparedRenderer,
  verifyPreparedRenderer,
} from "../src/lib/prepared-renderer";
const root = await mkdtemp(path.join(tmpdir(), "reelchemy-prepared-renderer-"));
after(() => rm(root, { recursive: true, force: true }));
async function fixture() {
  const build = path.join(root, randomUUID()),
    directory = path.join(build, RENDERER_DIRECTORY);
  await mkdir(path.join(directory, "public"), { recursive: true });
  await writeFile(path.join(build, "BUILD_ID"), "isolated-build-1");
  await writeFile(
    path.join(directory, "index.html"),
    "<!doctype html><script src='bundle.js'></script>",
  );
  await writeFile(
    path.join(directory, "bundle.js"),
    "console.log('private fixture');",
  );
  await writeFile(path.join(directory, "public", ".gitkeep"), "");
  await sealPreparedRenderer(directory, build);
  return { build, directory };
}
const refused = (f: { build: string }) =>
  assert.rejects(
    () => verifyPreparedRenderer(f.build),
    (error: unknown) =>
      error instanceof PreparedRendererUnavailable &&
      error.code === "PREPARED_RENDERER_UNAVAILABLE" &&
      !error.message.includes(root),
  );
test("a sealed production renderer matches its Next build and verification is read-only", async () => {
  const f = await fixture(),
    file = path.join(f.directory, "reelchemy-build.json"),
    before = await stat(file);
  assert.equal(await verifyPreparedRenderer(f.build), f.directory);
  const after = await stat(file);
  assert.equal(before.mtimeMs, after.mtimeMs);
  assert.equal(before.ino, after.ino);
  assert.equal((await readdir(f.directory)).length, 4);
});
test("production refuses absent, mixed-build, incomplete and corrupt renderer contents", async () => {
  await assert.rejects(
    () => verifyPreparedRenderer(path.join(root, "missing")),
    PreparedRendererUnavailable,
  );
  for (const change of [
    async (f: Awaited<ReturnType<typeof fixture>>) =>
      writeFile(path.join(f.build, "BUILD_ID"), "other-build"),
    async (f: Awaited<ReturnType<typeof fixture>>) =>
      writeFile(path.join(f.directory, "bundle.js"), "changed-content"),
    async (f: Awaited<ReturnType<typeof fixture>>) =>
      unlink(path.join(f.directory, "index.html")),
    async (f: Awaited<ReturnType<typeof fixture>>) =>
      writeFile(path.join(f.directory, "unknown.js"), "unexpected"),
    async (f: Awaited<ReturnType<typeof fixture>>) =>
      writeFile(path.join(f.directory, "reelchemy-build.json"), "{}"),
  ]) {
    const f = await fixture();
    await change(f);
    await refused(f);
  }
});
test("renderer verification refuses root/file/directory links without changing their external target", async () => {
  const external = path.join(root, "outside.js");
  await writeFile(external, "Preserve this external source");
  const f = await fixture();
  await unlink(path.join(f.directory, "bundle.js"));
  await symlink(external, path.join(f.directory, "bundle.js"));
  await refused(f);
  const d = await fixture();
  await symlink(root, path.join(d.directory, "linked-public"));
  await refused(d);
  const s = path.join(root, randomUUID());
  await mkdir(s);
  await writeFile(path.join(s, "BUILD_ID"), "isolated-build-1");
  await symlink(d.directory, path.join(s, RENDERER_DIRECTORY));
  await refused({ build: s });
  assert.equal(
    await readFile(external, "utf8"),
    "Preserve this external source",
  );
});
test("oversized manifests and unsafe build identifiers fail with a fixed private error", async () => {
  const f = await fixture();
  await writeFile(
    path.join(f.directory, "reelchemy-build.json"),
    "x".repeat(128 * 1024 + 1),
  );
  await refused(f);
  const g = await fixture();
  await writeFile(
    path.join(g.build, "BUILD_ID"),
    "../../private-account-state",
  );
  await refused(g);
});
test(
  "production worker refuses missing prepared assets before publishing readiness and preserves its permanent lifecycle inode",
  { skip: process.platform !== "linux", timeout: 15000 },
  async () => {
    const data = path.join(root, randomUUID());
    await mkdir(data);
    Object.assign(process.env, {
      REELCHEMY_DATA_DIR: data,
      REELCHEMY_ARTIFACT_DIR: path.join(data, "exports"),
    });
    const db = await import("../src/lib/db");
    const { blankTimeline } = await import("../src/lib/editor");
    const studio = db.ensureWorkspace(
      "prepared-renderer-private-owner",
      "Private fixture",
    );
    const brief = {
      prompt: "Preserved queued export",
      duration: 5,
      format: "landscape" as const,
    };
    const project = db.createProject(brief, studio.id);
    db.reviseProject(project, blankTimeline(brief), "Private queued fixture");
    const job = db.createJob(project);
    const lifecycle = path.join(data, "worker.lifecycle.lock");
    await writeFile(lifecycle, "Permanent inode canary");
    const before = await stat(lifecycle);
    const child = spawn(
      process.execPath,
      ["--import", "tsx", "scripts/worker-entrypoint.ts"],
      {
        env: {
          ...process.env,
          NODE_ENV: "production",
          REELCHEMY_DATA_DIR: data,
          REELCHEMY_ARTIFACT_DIR: path.join(data, "exports"),
          REELCHEMY_RENDER_CACHE_DIR: path.join(data, "cache"),
          REELCHEMY_NEXT_DIST_DIR: path.join(data, "missing-build"),
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let output = "";
    for (const stream of [child.stdout, child.stderr])
      stream.on("data", (bytes) => (output += bytes.toString()));
    const timer = setTimeout(() => child.kill("SIGKILL"), 10000);
    try {
      const code = await new Promise<number | null>((resolve, reject) => {
        child.once("error", reject);
        child.once("close", resolve);
      });
      assert.equal(code, 1, output);
      assert.match(output, /prepared video renderer is unavailable/);
      assert.doesNotMatch(output, /Reelchemy render worker ready|render.start/);
      assert.equal(db.getJob(job.id)?.status, "queued");
      assert.equal((await stat(lifecycle)).ino, before.ino);
      assert.equal(await readFile(lifecycle, "utf8"), "Permanent inode canary");
      await assert.rejects(() =>
        stat(path.join(data, "worker-heartbeat.json")),
      );
      await assert.rejects(() => stat(path.join(data, "worker.lock")));
    } finally {
      clearTimeout(timer);
      child.kill("SIGTERM");
    }
  },
);
