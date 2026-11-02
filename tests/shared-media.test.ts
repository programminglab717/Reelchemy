import { test, after } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  access,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { randomUUID, createHash } from "node:crypto";
import Database from "better-sqlite3";
import { blankTimeline } from "../src/lib/editor";
import type { Asset, Project } from "../src/lib/schema";
import {
  DEFAULT_SHARED_MEDIA_STORAGE_BYTES,
  sharedMediaStorageLimit,
  MediaStorageLimitError,
} from "../src/lib/media-storage-policy";
import {
  spawnTestProcess,
  shutdownTestProcesses,
} from "../scripts/test-process";
const MiB = 1024 ** 2,
  root = await mkdtemp(path.join(tmpdir(), "reelchemy-shared-media-")),
  files = path.join(root, "assets");
Object.assign(process.env, {
  REELCHEMY_DATA_DIR: root,
  REELCHEMY_ARTIFACT_DIR: path.join(root, "exports"),
  REELCHEMY_MEDIA_STORAGE_BYTES: String(2 * MiB),
  REELCHEMY_MEDIA_SHARED_STORAGE_BYTES: String(2 * MiB),
});
await mkdir(files);
const brief = {
  prompt: "Private retained media",
  duration: 5,
  format: "landscape" as const,
};
const metadata = (id: string): Asset => ({
  id,
  name: "Private owned fixture",
  source: "Fixture",
  license: "Owned",
  mime: "image/png",
  createdAt: new Date().toISOString(),
  bytes: 1,
});
const ids = [randomUUID(), randomUUID(), randomUUID()],
  legacyId = randomUUID();
const orphanId = randomUUID();
await writeFile(path.join(files, orphanId), Buffer.alloc(64 * 1024, 9));
for (let i = 0; i < ids.length; i++)
  await writeFile(
    path.join(files, ids[i]),
    Buffer.alloc((i + 1) * 64 * 1024, i + 1),
  );
const picture = (id: string) => {
  const timeline = blankTimeline(brief);
  timeline.scenes[0].layers[0] = {
    ...timeline.scenes[0].layers[0],
    kind: "image",
    assetId: id,
    text: "",
  };
  return timeline;
};
const legacy: Project = {
  id: legacyId,
  name: "Retained legacy",
  brief,
  timeline: null,
  createdAt: new Date().toISOString(),
  revisions: [
    {
      id: randomUUID(),
      source: "Historical artwork",
      createdAt: new Date().toISOString(),
      timeline: picture(ids[1]),
    },
  ],
  messages: [],
  assets: [metadata(ids[0])],
};
const raw = new Database(path.join(root, "studio.sqlite"));
raw.exec(
  "CREATE TABLE projects(id TEXT PRIMARY KEY,data TEXT NOT NULL);CREATE TABLE jobs(id TEXT PRIMARY KEY,project_id TEXT NOT NULL,status TEXT NOT NULL,data TEXT NOT NULL,timeline TEXT NOT NULL)",
);
raw.exec(
  "CREATE TABLE media_sizes(asset_id TEXT PRIMARY KEY,bytes INTEGER NOT NULL)",
);
raw.prepare("INSERT INTO media_sizes VALUES(?,1)").run(orphanId);
raw
  .prepare("INSERT INTO projects VALUES(?,?)")
  .run(legacyId, JSON.stringify(legacy));
raw
  .prepare("INSERT INTO jobs VALUES(?,?,'completed',?,?)")
  .run(randomUUID(), legacyId, "{}", JSON.stringify(picture(ids[2])));
raw.close();
const app = await import("../src/lib/db"),
  inspect = new Database(path.join(root, "studio.sqlite"));
const children: ReturnType<typeof spawnTestProcess>[] = [];
after(async () => {
  await shutdownTestProcesses(children);
  inspect.close();
  await rm(root, { recursive: true, force: true });
});
const fileHash = async (id: string) =>
  createHash("sha256")
    .update(await readFile(path.join(files, id)))
    .digest("hex");
test("shared media policy is bounded, consistent with a studio allowance, and service failures expose no shared usage", async () => {
  assert.equal(sharedMediaStorageLimit({}), DEFAULT_SHARED_MEDIA_STORAGE_BYTES);
  assert.equal(
    sharedMediaStorageLimit({
      REELCHEMY_MEDIA_STORAGE_BYTES: String(MiB),
      REELCHEMY_MEDIA_SHARED_STORAGE_BYTES: String(MiB),
    }),
    MiB,
  );
  for (const value of [
    "0",
    "-1",
    "1.5",
    "1048575",
    "1e9",
    String(4 * 1024 ** 4 + 1),
  ])
    assert.throws(() =>
      sharedMediaStorageLimit({ REELCHEMY_MEDIA_SHARED_STORAGE_BYTES: value }),
    );
  assert.throws(() =>
    sharedMediaStorageLimit({
      REELCHEMY_MEDIA_SHARED_STORAGE_BYTES: String(MiB),
    }),
  );
  const { failure } = await import("../src/lib/http"),
    response = failure(
      new MediaStorageLimitError(9123456, 10000000, 9999999, "service"),
    ),
    body = await response.json();
  assert.equal(response.status, 503);
  assert.deepEqual(Object.keys(body).sort(), ["code", "error", "scope"]);
  assert.equal(body.code, "MEDIA_SERVICE_STORAGE_LIMIT");
  assert(!JSON.stringify(body).includes("9123456"));
  assert.equal(response.headers.get("Cache-Control"), "private, no-store");
});
test("the additive census accounts for current, historical-only and job-only files with real bytes while preserving legacy data and sources", async () => {
  const before = await Promise.all(ids.map(fileHash));
  assert.equal(app.sharedMediaStorage().usedBytes, 448 * 1024);
  assert.equal(app.sharedMediaStorage().assetCount, 4);
  assert.equal(
    (
      inspect.prepare("SELECT data FROM projects WHERE id=?").get(legacyId) as {
        data: string;
      }
    ).data,
    JSON.stringify(legacy),
  );
  const owner = app.ensureWorkspace("shared-census-owner", "Owner");
  app.claimLegacyProjects(owner.id, true);
  assert.equal(app.mediaStorage(owner.id).usedBytes, 384 * 1024);
  assert.equal(app.mediaStorage(owner.id).assetCount, 3);
  assert.equal(app.recountMediaStorage().totalBytes, 448 * 1024);
  assert.deepEqual(await Promise.all(ids.map(fileHash)), before);
  assert(
    inspect
      .prepare(
        "SELECT 1 FROM schema_migrations WHERE id='retained-media-size-census-v2'",
      )
      .get(),
  );
});
let winning: { workspace: string; project: Project; asset: Asset } | undefined;
test(
  "independent studios cannot overspend shared normalized storage through simultaneous SQLite attachments",
  { timeout: 30000 },
  async () => {
    const go = path.join(root, "race.go"),
      actors = [];
    for (const label of ["a", "b"]) {
      const workspace = app.ensureWorkspace(`shared-race-${label}`, label).id,
        project = app.createProject(brief, workspace),
        asset = metadata(randomUUID());
      await writeFile(path.join(files, asset.id), Buffer.alloc(900 * 1024, 7));
      actors.push({ workspace, project, asset, label });
    }
    const script = `import {existsSync,writeFileSync} from 'node:fs';const module=await import(${JSON.stringify(pathToFileURL(path.resolve("src/lib/db.ts")).href)});const app=module.default||module;writeFileSync(process.env.PRIVATE_READY,'ready');const end=Date.now()+15000;while(!existsSync(process.env.PRIVATE_GO)){if(Date.now()>end)throw new Error('Private barrier timed out');await new Promise(resolve=>setTimeout(resolve,10));}try{app.appendOwnedAsset(process.env.PRIVATE_PROJECT,process.env.PRIVATE_STUDIO,JSON.parse(process.env.PRIVATE_ASSET));console.log('admitted');}catch(error){if(error.code!=='MEDIA_SERVICE_STORAGE_LIMIT')throw error;console.log('refused');}`;
    const runs = actors.map((actor) => {
      const ready = path.join(root, `${actor.label}.ready`),
        child = spawnTestProcess(
          process.execPath,
          ["--import", "tsx", "--input-type=module", "--eval", script],
          {
            env: {
              ...process.env,
              PRIVATE_READY: ready,
              PRIVATE_GO: go,
              PRIVATE_PROJECT: actor.project.id,
              PRIVATE_STUDIO: actor.workspace,
              PRIVATE_ASSET: JSON.stringify(actor.asset),
            },
            stdio: ["ignore", "pipe", "pipe"],
          },
        );
      children.push(child);
      let output = "",
        errors = "";
      child.stdout!.on("data", (value) => (output += value.toString()));
      child.stderr!.on("data", (value) => (errors += value.toString()));
      const done = new Promise<string>((resolve, reject) => {
        child.once("error", reject);
        child.once("close", (code) =>
          code === 0
            ? resolve(output.trim())
            : reject(new Error(errors || "Private writer failed")),
        );
      });
      return { ready, done, actor };
    });
    const end = Date.now() + 15000;
    while (true) {
      if (
        (
          await Promise.all(
            runs.map((run) =>
              access(run.ready).then(
                () => true,
                () => false,
              ),
            ),
          )
        ).every(Boolean)
      )
        break;
      if (Date.now() > end)
        throw new Error("Private writer readiness timed out");
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    await writeFile(go, "go");
    const outcomes = await Promise.all(runs.map((run) => run.done));
    assert.deepEqual([...outcomes].sort(), ["admitted", "refused"]);
    winning = runs[outcomes.indexOf("admitted")].actor;
    assert.equal(app.sharedMediaStorage().usedBytes, (448 + 900) * 1024);
    assert.equal(app.sharedMediaStorage().assetCount, 5);
    assert.equal(
      actors.reduce(
        (sum, actor) =>
          sum + (app.getProject(actor.project.id)?.assets?.length || 0),
        0,
      ),
      1,
    );
  },
);
test("readable legacy overages allow zero-byte reuse and asset-free imports while new file growth stays blocked", () => {
  assert(winning);
  process.env.REELCHEMY_MEDIA_STORAGE_BYTES = String(MiB);
  process.env.REELCHEMY_MEDIA_SHARED_STORAGE_BYTES = String(MiB);
  const before = app.sharedMediaStorage().usedBytes,
    target = app.createProject(brief, winning.workspace);
  assert(app.appendOwnedAsset(target.id, winning.workspace, winning.asset));
  assert.equal(app.sharedMediaStorage().usedBytes, before);
  const copy: Project = {
    ...target,
    id: randomUUID(),
    assets: [],
    revisions: [],
    messages: [],
  };
  assert(app.saveImportedProject(copy, winning.workspace));
  assert.equal(app.sharedMediaStorage().usedBytes, before);
  assert.throws(
    () => app.assertSharedMediaCapacity(1),
    (error: unknown) =>
      error instanceof MediaStorageLimitError && error.scope === "service",
  );
});
