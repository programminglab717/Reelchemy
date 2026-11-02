import { test, after } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  stat,
  rename,
  utimes,
  access,
  rm,
} from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { createHash, randomUUID } from "node:crypto";
import sharp from "sharp";
import { blankTimeline } from "../src/lib/editor";
import { recentHeartbeat } from "../src/lib/worker-heartbeat";
import {
  spawnTestProcess,
  shutdownTestProcesses,
} from "../scripts/test-process";
const root = await mkdtemp(path.join(tmpdir(), "reelchemy-cache-worker-"));
Object.assign(process.env, {
  REELCHEMY_DATA_DIR: path.join(root, "data"),
  REELCHEMY_AUTH_DIR: path.join(root, "auth"),
  REELCHEMY_ARTIFACT_DIR: path.join(root, "exports"),
  REELCHEMY_RENDER_CACHE_DIR: path.join(root, "cache"),
  REELCHEMY_SCENE_CACHE_BYTES: String(1024 ** 2),
  REELCHEMY_SCENE_CACHE_BYTES_PER_STUDIO: String(1024 ** 2),
  REELCHEMY_SCENE_CACHE_DAYS: "1",
  AI_PROVIDER: "mock",
});
const app = await import("../src/lib/db");
const { storeImage } = await import("../src/lib/assets");
const workers: ReturnType<typeof spawnTestProcess>[] = [];
after(async () => {
  await shutdownTestProcesses(workers);
  await rm(root, { recursive: true, force: true });
});
async function wait<T>(
  read: () => T | Promise<T>,
  message: string,
  milliseconds = 60000,
): Promise<NonNullable<T>> {
  const end = Date.now() + milliseconds;
  while (Date.now() < end) {
    const result = await read();
    if (result) return result as NonNullable<T>;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(message);
}
function start() {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    REELCHEMY_AUTH_DIR: "/reelchemy-test-no-auth-access",
  };
  for (const name of Object.keys(env))
    if (
      name.startsWith("AI_") ||
      name.startsWith("SMTP_") ||
      ["BETTER_AUTH_SECRET", "BETTER_AUTH_URL", "EMAIL_FROM"].includes(name)
    )
      delete env[name];
  const child = spawnTestProcess(
    process.execPath,
    ["--import", "tsx", "scripts/worker-entrypoint.ts"],
    { env, stdio: ["ignore", "pipe", "pipe"] },
  );
  workers.push(child);
  let output = "";
  for (const stream of [child.stdout, child.stderr])
    stream?.on("data", (value) => {
      output = (output + value.toString()).slice(-12000);
    });
  return { child, output: () => output };
}
async function hash(file: string) {
  return createHash("sha256")
    .update(await readFile(file))
    .digest("hex");
}
async function completed(id: string) {
  return wait(() => {
    const job = app.getJob(id)!;
    if (job.status === "failed")
      throw new Error(job.error || "Private cache export failed");
    return job.status === "completed" ? job : null;
  }, "Private cache export did not complete");
}
test(
  "real worker pauses unsafe cache state, recovers, reuses verified clips and rebuilds expired ones without changing uploads or finished exports",
  { timeout: 115000 },
  async () => {
    const studio = app.ensureWorkspace("private-cache-owner", "Cache owner");
    const brief = {
      prompt: "Cache continuity",
      duration: 5,
      format: "landscape" as const,
    };
    const asset = await storeImage(
      await sharp({
        create: { width: 32, height: 24, channels: 3, background: "#2eb0a6" },
      })
        .png()
        .toBuffer(),
      "Owned.png",
      "Synthetic artwork owned by this test",
    );
    const p = app.createProject(brief, studio.id);
    p.assets = [asset];
    app.saveProject(p);
    const timeline = blankTimeline(brief);
    timeline.scenes[0].layers.push({
      ...timeline.scenes[0].layers[0],
      id: "picture",
      kind: "image",
      text: "",
      assetId: asset.id,
      x: 0.08,
      y: 0.08,
      width: 0.2,
      height: 0.2,
    });
    app.reviseProject(p, timeline, "Test cut");
    const source = path.join(app.dataDir, "assets", asset.id),
      sourceHash = await hash(source);
    const otherExport = path.join(app.artifactDir, randomUUID(), "video.mp4");
    await mkdir(path.dirname(otherExport), { recursive: true });
    await writeFile(otherExport, "Unrelated finished export canary");
    const exportHash = await hash(otherExport);
    const cache = process.env.REELCHEMY_RENDER_CACHE_DIR!;
    const expired = path.join(cache, studio.id, "a".repeat(64));
    await mkdir(expired, { recursive: true });
    await writeFile(path.join(expired, "video.mp4"), "Old derived clip");
    await writeFile(path.join(expired, "manifest.json"), "{}");
    const old = new Date(Date.now() - 2 * 86400000);
    await utimes(path.join(expired, "manifest.json"), old, old);
    const unknown = path.join(cache, "user-film.mov");
    await writeFile(unknown, "Unknown files must be preserved");
    const first = app.createJob(p),
      worker = start();
    const blocked = await wait(
      async () => {
        try {
          const value = JSON.parse(
            await readFile(
              path.join(app.dataDir, "worker-heartbeat.json"),
              "utf8",
            ),
          );
          return value.ready === false &&
            worker.output().includes("cache.prune.blocked")
            ? value
            : null;
        } catch {
          return null;
        }
      },
      "Unsafe cache was not reported before claiming the export",
      15000,
    );
    assert.equal(recentHeartbeat(blocked), false);
    assert.equal(app.getJob(first.id)!.status, "queued");
    await access(path.join(expired, "video.mp4"));
    const lifecycle = path.join(app.dataDir, "worker.lifecycle.lock"),
      inode = (await stat(lifecycle)).ino;
    const quarantine = path.join(root, "preserved-user-film.mov");
    await rename(unknown, quarantine);
    const done = await completed(first.id);
    assert.equal(
      (done.report!.sceneCache as { reused: boolean }[])[0].reused,
      false,
    );
    await assert.rejects(() => access(expired));
    const firstFile = path.join(app.artifactDir, first.id, "video.mp4"),
      firstHash = await hash(firstFile);
    const second = app.createJob(app.getProject(p.id)!);
    const reused = await completed(second.id);
    const cacheEntry = (
      reused.report!.sceneCache as { reused: boolean; key: string }[]
    )[0];
    assert.equal(cacheEntry.reused, true);
    const secondFile = path.join(app.artifactDir, second.id, "video.mp4"),
      secondHash = await hash(secondFile);
    await shutdownTestProcesses([worker.child]);
    const manifest = path.join(
      cache,
      studio.id,
      cacheEntry.key,
      "manifest.json",
    );
    await utimes(manifest, old, old);
    const third = app.createJob(app.getProject(p.id)!);
    start();
    const rebuilt = await completed(third.id);
    assert.equal(
      (rebuilt.report!.sceneCache as { reused: boolean }[])[0].reused,
      false,
    );
    assert.equal((await stat(lifecycle)).ino, inode);
    assert.equal(await hash(source), sourceHash);
    assert.equal(await hash(otherExport), exportHash);
    assert.equal(await hash(firstFile), firstHash);
    assert.equal(await hash(secondFile), secondHash);
    assert.equal(
      await readFile(quarantine, "utf8"),
      "Unknown files must be preserved",
    );
    assert.equal(app.getProject(p.id)!.revisions.length, 1);
    assert.deepEqual(app.getProject(p.id)!.timeline, timeline);
  },
);
