import { test, after } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  rm,
  readFile,
  writeFile,
  mkdir,
  access,
  symlink,
  rename,
  unlink,
  stat,
} from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { randomBytes, createHash } from "node:crypto";
import Database from "better-sqlite3";
import sharp from "sharp";
import type { ChildProcess } from "node:child_process";
import {
  spawnTestProcess,
  shutdownTestProcesses,
} from "../scripts/test-process";
import { blankTimeline } from "../src/lib/editor";
import { HEARTBEAT_NAME, recentHeartbeat } from "../src/lib/worker-heartbeat";

const dir = await mkdtemp(path.join(tmpdir(), "reelchemy-project-deletion-"));
process.env.REELCHEMY_DATA_DIR = path.join(dir, "data");
process.env.REELCHEMY_AUTH_DIR = path.join(dir, "auth");
process.env.REELCHEMY_ARTIFACT_DIR = path.join(dir, "artifacts");
process.env.REELCHEMY_RENDER_CACHE_DIR = path.join(dir, "cache");
process.env.BETTER_AUTH_URL = "http://127.0.0.1:3001";
process.env.BETTER_AUTH_SECRET = randomBytes(48).toString("base64url");
process.env.EMAIL_DELIVERY = "file";
process.env.AI_PROVIDER = "mock";
const app = await import("../src/lib/db");
const { POST, GET } =
  await import("../src/app/api/projects/[id]/deletion/route");
const { GET: listing } =
  await import("../src/app/api/workspace/deletions/route");
const { GET: projectGET } = await import("../src/app/api/projects/[id]/route");
const { POST: restore } =
  await import("../src/app/api/projects/[id]/trash/route");
const { storeImage } = await import("../src/lib/assets");
const workers: ChildProcess[] = [];
after(async () => {
  await shutdownTestProcesses(workers);
  await rm(dir, { recursive: true, force: true });
});
const brief = {
  prompt: "Private cleanup test",
  duration: 5,
  format: "landscape" as const,
};
const childrenErrors = new WeakMap<ChildProcess, () => string>();
async function waitFor(
  check: () => boolean | Promise<boolean>,
  message: string,
  milliseconds = 30000,
) {
  const deadline = Date.now() + milliseconds;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(message);
}
async function startWorker() {
  const env: NodeJS.ProcessEnv = { ...process.env, NODE_ENV: "production" };
  for (const name of [
    "BETTER_AUTH_SECRET",
    "REELCHEMY_AUTH_DIR",
    "AI_API_KEY",
    "SMTP_PASSWORD",
    "SMTP_USER",
  ])
    delete env[name];
  const child = spawnTestProcess(
    process.execPath,
    ["--import", "tsx", "scripts/worker-entrypoint.ts"],
    { env, stdio: ["ignore", "ignore", "pipe"] },
  );
  workers.push(child);
  let errors = "";
  child.stderr?.on("data", (bytes) => {
    errors = (errors + String(bytes)).slice(-6000);
  });
  childrenErrors.set(child, () => errors);
  await waitFor(async () => {
    if (child.exitCode !== null)
      throw new Error(errors || "Private cleanup worker exited.");
    try {
      return recentHeartbeat(
        JSON.parse(
          await readFile(path.join(app.dataDir, HEARTBEAT_NAME), "utf8"),
        ),
      );
    } catch {
      return false;
    }
  }, "Private cleanup worker did not become ready.");
  return child;
}
async function stopWorker(child: ChildProcess) {
  await shutdownTestProcesses([child]);
}
async function account(label: string) {
  const { getAuth } = await import("../src/lib/auth");
  const auth = await getAuth();
  const email = `${label}@example.test`,
    password = "Synthetic-cleanup-passphrase-4826";
  const signup = await auth.api.signUpEmail({
    body: { name: label, email, password },
  });
  const admin = new Database(
    path.join(process.env.REELCHEMY_AUTH_DIR!, "auth.sqlite"),
  );
  admin
    .prepare('UPDATE "user" SET emailVerified=1 WHERE id=?')
    .run(signup.user.id);
  admin.close();
  const login = await auth.api.signInEmail({
    body: { email, password },
    asResponse: true,
  });
  assert.equal(login.status, 200);
  return {
    workspace: app.ensureWorkspace(signup.user.id, label).id,
    cookie: login.headers
      .getSetCookie()
      .map((c) => c.split(";")[0])
      .join("; "),
  };
}
function request(
  id: string,
  cookie = "",
  method = "POST",
  data: unknown = { confirmation: "DELETE" },
) {
  return new Request(`http://127.0.0.1:3001/api/projects/${id}/deletion`, {
    method,
    headers: {
      host: "127.0.0.1:3001",
      origin: "http://127.0.0.1:3001",
      cookie,
      "content-type": "application/json",
    },
    ...(method === "POST" ? { body: JSON.stringify(data) } : {}),
  });
}
function context(id: string) {
  return { params: Promise.resolve({ id }) };
}
function project(owner: string, title = "Private cleanup test") {
  const p = app.createProject({ ...brief, prompt: title }, owner);
  return app.reviseProject(p, blankTimeline(p.brief), "Initial manual work");
}
async function image(projectId: string, owner: string) {
  const asset = await storeImage(
    await sharp({
      create: { width: 64, height: 64, channels: 3, background: "#00b6a3" },
    })
      .png()
      .toBuffer(),
    "Synthetic image.png",
    "Generated test fixture",
  );
  app.appendOwnedAsset(projectId, owner, asset);
  return asset;
}

test("authenticated project deletion is private and the real worker reclaims only authorized live data", async (t) => {
  const owner = await account("cleanup-owner"),
    other = await account("cleanup-other");
  const p = project(owner.workspace, "API deletion fixture");
  const asset = await image(p.id, owner.workspace);
  let worker: ChildProcess | undefined;
  await t.test(
    "verified owner, explicit confirmation and Trash are required; pending intent cannot restore or leak across owners",
    async () => {
      assert.equal((await POST(request(p.id), context(p.id))).status, 401);
      assert.equal(
        (await POST(request(p.id, other.cookie), context(p.id))).status,
        404,
      );
      const active = await POST(request(p.id, owner.cookie), context(p.id));
      assert.equal(active.status, 409);
      assert.equal((await active.json()).code, "PROJECT_DELETION_CONFLICT");
      app.setProjectTrashed(p.id, true);
      assert.equal(
        (
          await POST(
            request(p.id, owner.cookie, "POST", { confirmation: "delete" }),
            context(p.id),
          )
        ).status,
        400,
      );
      const malformed = new Request(
        `http://127.0.0.1:3001/api/projects/${p.id}/deletion`,
        {
          method: "POST",
          headers: { host: "127.0.0.1:3001", cookie: owner.cookie },
          body: "not-json",
        },
      );
      assert.equal((await POST(malformed, context(p.id))).status, 400);
      const queued = await POST(request(p.id, owner.cookie), context(p.id));
      assert.equal(queued.status, 202);
      assert.equal(queued.headers.get("cache-control"), "private, no-store");
      const receipt = await queued.json();
      assert.deepEqual(
        await (await POST(request(p.id, owner.cookie), context(p.id))).json(),
        receipt,
      );
      assert.equal(
        (await GET(request(p.id, other.cookie, "GET"), context(p.id))).status,
        404,
      );
      assert.equal(
        (await projectGET(request(p.id, owner.cookie, "GET"), context(p.id)))
          .status,
        404,
      );
      assert.equal(
        (await restore(request(p.id, owner.cookie), context(p.id))).status,
        404,
      );
      const own = await listing(
        new Request(
          "http://127.0.0.1:3001/api/workspace/deletions?workspaceId=ignored",
          { headers: { cookie: owner.cookie } },
        ),
        { params: Promise.resolve({}) },
      );
      const ownBody = await own.json();
      assert.equal(ownBody.total, 1);
      assert(!JSON.stringify(ownBody).includes(asset.id));
      const foreign = await listing(
        new Request("http://127.0.0.1:3001/api/workspace/deletions", {
          headers: { cookie: other.cookie },
        }),
        { params: Promise.resolve({}) },
      );
      assert.equal((await foreign.json()).total, 0);
      assert(await stat(path.join(app.dataDir, "assets", asset.id)));
    },
  );

  await t.test(
    "a restore during request-body streaming wins safely before deletion admission",
    async () => {
      const current = project(owner.workspace, "Restore race");
      app.setProjectTrashed(current.id, true);
      const stream = new ReadableStream(
        {
          pull(controller) {
            app.setProjectTrashed(current.id, false);
            controller.enqueue(
              new TextEncoder().encode(
                JSON.stringify({ confirmation: "DELETE" }),
              ),
            );
            controller.close();
          },
        },
        { highWaterMark: 0 },
      );
      const req = new Request(
        `http://127.0.0.1:3001/api/projects/${current.id}/deletion`,
        {
          method: "POST",
          headers: { host: "127.0.0.1:3001", cookie: owner.cookie },
          body: stream,
          duplex: "half",
        } as RequestInit & { duplex: string },
      );
      assert.equal((await POST(req, context(current.id))).status, 409);
      assert.equal(
        app.ownedProjectDeletion(current.id, owner.workspace),
        undefined,
      );
      assert.equal(app.projectInWorkspace(current.id, owner.workspace), true);
    },
  );

  try {
    await t.test(
      "active export cancellation finishes before cleanup; shared media, other exports and subsequent work survive",
      async () => {
        const keep = project(owner.workspace, "Retained shared project");
        const shared = await image(keep.id, owner.workspace);
        const beforeOther = project(other.workspace, "Retained export");
        const retainedJob = app.createJob(beforeOther);
        worker = await startWorker();
        await waitFor(
          () => {
            const job = app.getJob(retainedJob.id)!;
            if (job.status === "failed")
              throw new Error(job.error || childrenErrors.get(worker!)!());
            return job.status === "completed";
          },
          "Initial retained export did not complete.",
          60000,
        );
        const retainedFile = path.join(
          app.artifactDir,
          retainedJob.id,
          "video.mp4",
        );
        const retainedHash = createHash("sha256")
          .update(await readFile(retainedFile))
          .digest("hex");
        const current = project(
          owner.workspace,
          "Cancel then permanently remove",
        );
        const unique = await image(current.id, owner.workspace);
        app.appendOwnedAsset(current.id, owner.workspace, shared);
        const timeline = structuredClone(current.timeline!);
        timeline.scenes[0].layers[0] = {
          ...timeline.scenes[0].layers[0],
          kind: "image",
          assetId: unique.id,
        };
        const edited = app.reviseProject(
          app.getProject(current.id)!,
          timeline,
          "Owned image",
        );
        const running = app.createJob(edited);
        await waitFor(
          () => app.getJob(running.id)?.stage === "Rendering frames",
          "Export did not enter frame rendering.",
        );
        app.setProjectTrashed(current.id, true);
        assert.equal(
          (await POST(request(current.id, owner.cookie), context(current.id)))
            .status,
          202,
        );
        await waitFor(
          () =>
            app.ownedProjectDeletion(current.id, owner.workspace)?.state ===
            "completed",
          "Cancelled project cleanup did not complete.",
        );
        await assert.rejects(() =>
          access(path.join(app.dataDir, "assets", unique.id)),
        );
        await assert.rejects(() =>
          access(path.join(app.artifactDir, running.id)),
        );
        assert(await stat(path.join(app.dataDir, "assets", shared.id)));
        assert(app.getProject(keep.id));
        assert.equal(
          createHash("sha256")
            .update(await readFile(retainedFile))
            .digest("hex"),
          retainedHash,
        );
        const after = project(other.workspace, "Export after cleanup");
        const next = app.createJob(after);
        await waitFor(
          () => {
            const job = app.getJob(next.id)!;
            if (job.status === "failed")
              throw new Error(job.error || "Subsequent export failed.");
            return job.status === "completed";
          },
          "Another studio could not export after cleanup.",
          60000,
        );
        assert(
          (await stat(path.join(app.artifactDir, next.id, "video.mp4"))).size >
            1000,
        );
        await waitFor(
          () =>
            app.ownedProjectDeletion(p.id, owner.workspace)?.state ===
            "completed",
          "Initial API intent was not processed.",
        );
        assert.equal(
          (await POST(request(p.id, owner.cookie), context(p.id))).status,
          200,
        );
        assert.equal(app.getProject(p.id), undefined);
        assert.equal(app.mediaStorage(owner.workspace).usedBytes, shared.bytes);
        await stopWorker(worker!);
        worker = undefined;
      },
    );
    await t.test(
      "cleanup unlinks owned symlinks without following their media/export targets",
      async () => {
        const current = project(owner.workspace, "Symlink cleanup");
        const normalized = await image(current.id, owner.workspace);
        const syntheticJob = app.createJob(app.getProject(current.id)!);
        app.updateJob(syntheticJob.id, { status: "cancelled" });
        app.setProjectTrashed(current.id, true);
        const outside = path.join(dir, "outside-owned-roots");
        await mkdir(outside, { recursive: true });
        const canary = path.join(outside, "keep.txt");
        await writeFile(canary, "unrelated synthetic content");
        const mediaFile = path.join(app.dataDir, "assets", normalized.id);
        await unlink(mediaFile);
        await symlink(canary, mediaFile);
        await symlink(outside, path.join(app.artifactDir, syntheticJob.id));
        assert.equal(
          (await POST(request(current.id, owner.cookie), context(current.id)))
            .status,
          202,
        );
        worker = await startWorker();
        await waitFor(
          () =>
            app.ownedProjectDeletion(current.id, owner.workspace)?.state ===
            "completed",
          "Symlink entries were not removed.",
        );
        await assert.rejects(() => access(mediaFile));
        await assert.rejects(() =>
          access(path.join(app.artifactDir, syntheticJob.id)),
        );
        assert.equal(
          await readFile(canary, "utf8"),
          "unrelated synthetic content",
        );
        await stopWorker(worker!);
        worker = undefined;
      },
    );
    await t.test(
      "a symlinked media parent fails closed, preserves quota/data and can retry after storage repair",
      async () => {
        const current = project(owner.workspace, "Unsafe media parent");
        const beforeBytes = app.mediaStorage(owner.workspace).usedBytes;
        const normalized = await image(current.id, owner.workspace);
        app.setProjectTrashed(current.id, true);
        const assets = path.join(app.dataDir, "assets"),
          saved = path.join(app.dataDir, "assets-original");
        const outside = path.join(dir, "unsafe-parent-target");
        await mkdir(outside);
        const canary = path.join(outside, normalized.id);
        await writeFile(canary, "do not follow the parent symlink");
        await rename(assets, saved);
        await symlink(outside, assets);
        try {
          assert.equal(
            (await POST(request(current.id, owner.cookie), context(current.id)))
              .status,
            202,
          );
          worker = await startWorker();
          try {
            await waitFor(
              () =>
                app.ownedProjectDeletion(current.id, owner.workspace)?.state ===
                "failed",
              "Unsafe media parent did not reach bounded failure.",
              25000,
            );
          } catch {
            throw new Error(
              `Unsafe media parent did not reach bounded failure. Private fixture state: ${JSON.stringify(app.ownedProjectDeletion(current.id, owner.workspace))}; worker: ${childrenErrors.get(worker!)?.() || "no diagnostic output"}`,
            );
          }
          assert.equal(
            await readFile(canary, "utf8"),
            "do not follow the parent symlink",
          );
          assert(app.getProject(current.id));
          assert(app.mediaStorage(owner.workspace).usedBytes > beforeBytes);
          const status = await GET(
            request(current.id, owner.cookie, "GET"),
            context(current.id),
          );
          const body = JSON.stringify(await status.json());
          assert(!body.includes(outside));
          assert(!body.includes("do not follow"));
        } finally {
          if (worker) {
            await stopWorker(worker);
            worker = undefined;
          }
          await unlink(assets);
          await rename(saved, assets);
        }
        assert.equal(
          (await POST(request(current.id, owner.cookie), context(current.id)))
            .status,
          202,
        );
        worker = await startWorker();
        await waitFor(
          () =>
            app.ownedProjectDeletion(current.id, owner.workspace)?.state ===
            "completed",
          "Repaired cleanup did not resume.",
        );
        assert.equal(app.mediaStorage(owner.workspace).usedBytes, beforeBytes);
        assert.equal(
          await readFile(canary, "utf8"),
          "do not follow the parent symlink",
        );
        await stopWorker(worker!);
        worker = undefined;
      },
    );
    await t.test(
      "coordinated backup/restore omits pending deletion without changing the live source or retained media",
      async () => {
        const keep = project(owner.workspace, "Backup retained media");
        const shared = await image(keep.id, owner.workspace);
        const current = project(
          owner.workspace,
          "Do not resurrect after restore",
        );
        const unique = await image(current.id, owner.workspace);
        app.appendOwnedAsset(current.id, owner.workspace, shared);
        app.setProjectTrashed(current.id, true);
        assert.equal(
          (await POST(request(current.id, owner.cookie), context(current.id)))
            .status,
          202,
        );
        function stateHash() {
          const db = new Database(path.join(app.dataDir, "studio.sqlite"), {
            readonly: true,
          });
          try {
            return createHash("sha256")
              .update(
                JSON.stringify(
                  ["projects", "jobs", "project_deletions"].map((table) =>
                    db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all(),
                  ),
                ),
              )
              .digest("hex");
          } finally {
            db.close();
          }
        }
        const before = stateHash();
        const { createBackup, restoreBackup } =
          await import("../src/lib/backup");
        const output = path.join(dir, "backup");
        await createBackup({
          data: app.dataDir,
          auth: process.env.REELCHEMY_AUTH_DIR!,
          artifacts: app.artifactDir,
          output,
        });
        assert.equal(stateHash(), before);
        assert.equal(
          app.ownedProjectDeletion(current.id, owner.workspace)!.state,
          "queued",
        );
        assert(await stat(path.join(app.dataDir, "assets", unique.id)));
        await assert.rejects(() =>
          access(path.join(output, "data/assets", unique.id)),
        );
        assert(await stat(path.join(output, "data/assets", shared.id)));
        const restored = await restoreBackup(
          output,
          path.join(dir, "restored"),
        );
        const db = new Database(path.join(restored.data, "studio.sqlite"), {
          readonly: true,
        });
        try {
          assert.equal(
            db.prepare("SELECT id FROM projects WHERE id=?").get(current.id),
            undefined,
          );
          assert(db.prepare("SELECT id FROM projects WHERE id=?").get(keep.id));
          assert.deepEqual(
            db
              .prepare(
                "SELECT state,name,manifest FROM project_deletions WHERE project_id=?",
              )
              .get(current.id),
            { state: "completed", name: null, manifest: null },
          );
        } finally {
          db.close();
        }
        assert.equal(stateHash(), before);
        assert(await stat(path.join(restored.data, "assets", shared.id)));
        await assert.rejects(() =>
          access(path.join(restored.data, "assets", unique.id)),
        );
      },
    );
  } finally {
    if (worker) {
      await stopWorker(worker);
      worker = undefined;
    }
  }
});
