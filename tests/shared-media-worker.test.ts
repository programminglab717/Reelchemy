import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID, createHash } from "node:crypto";
import Database from "better-sqlite3";
import sharp from "sharp";
import type { Asset } from "../src/lib/schema";
import { startMediaWorker } from "./helpers/media-worker";
import {
  spawnTestProcess,
  shutdownTestProcesses,
} from "../scripts/test-process";
const root = await mkdtemp(path.join(tmpdir(), "reelchemy-shared-worker-")),
  limit = 2 * 1024 ** 2;
Object.assign(process.env, {
  REELCHEMY_DATA_DIR: path.join(root, "data"),
  REELCHEMY_AUTH_DIR: path.join(root, "auth"),
  REELCHEMY_ARTIFACT_DIR: path.join(root, "exports"),
  REELCHEMY_RENDER_CACHE_DIR: path.join(root, "cache"),
  REELCHEMY_MEDIA_STORAGE_BYTES: String(limit),
  REELCHEMY_MEDIA_SHARED_STORAGE_BYTES: String(limit),
});
const app = await import("../src/lib/db"),
  { receiveMediaRequest, mediaFailure } =
    await import("../src/lib/media-processing-http");
const inspect = new Database(path.join(root, "data", "studio.sqlite")),
  children: ReturnType<typeof spawnTestProcess>[] = [];
let ingest: Awaited<ReturnType<typeof startMediaWorker>> | undefined;
after(async () => {
  await ingest?.stop();
  await shutdownTestProcesses(children);
  inspect.close();
  await rm(root, { recursive: true, force: true });
});
async function until<T>(
  read: () => T | Promise<T>,
  message: string,
  milliseconds = 20000,
): Promise<NonNullable<T>> {
  const end = Date.now() + milliseconds;
  while (Date.now() < end) {
    const value = await read();
    if (value) return value as NonNullable<T>;
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
  throw new Error(message);
}
const owner = app.ensureWorkspace("shared-upload-owner", "Owner").id,
  other = app.ensureWorkspace("shared-upload-other", "Other").id;
const brief = {
  prompt: "Shared media recovery",
  duration: 5,
  format: "landscape" as const,
};
async function fill(projectId: string, bytes: number) {
  const id = randomUUID(),
    file = path.join(app.dataDir, "assets", id);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, Buffer.alloc(bytes, 37));
  const metadata: Asset = {
    id,
    name: "Retained other-studio source",
    mime: "image/png",
    source: "Fixture",
    license: "Owned",
    createdAt: new Date().toISOString(),
    bytes: 1,
  };
  assert(app.appendOwnedAsset(projectId, other, metadata));
  return {
    id,
    file,
    hash: createHash("sha256")
      .update(await readFile(file))
      .digest("hex"),
  };
}
test(
  "real ingestion refuses late shared saturation without leaking usage or attaching output, then reclaims only confirmed source data and retries/replays safely at capacity",
  { timeout: 90000 },
  async () => {
    const p = app.createProject(brief, owner),
      fillerProject = app.createProject(brief, other),
      png = await sharp({
        create: { width: 24, height: 18, channels: 3, background: "#2eb0a6" },
      })
        .png()
        .toBuffer();
    const request = (key: string) => {
      const form = new FormData();
      form.set(
        "file",
        new File([new Uint8Array(png)], "owned.png", { type: "image/png" }),
      );
      form.set("license", "Synthetic artwork owned by this fixture");
      return new Request(`http://127.0.0.1:3001/api/projects/${p.id}/assets`, {
        method: "POST",
        headers: { "Idempotency-Key": key, Prefer: "respond-async" },
        body: form,
      });
    };
    const key = randomUUID(),
      queued = await receiveMediaRequest(request(key), owner, p.id, "upload");
    assert.equal(queued.status, 202, await queued.clone().text());
    const receipt = (await queued.json()).request;
    const filler = await fill(fillerProject.id, limit);
    assert.equal(app.sharedMediaStorage().usedBytes, limit);
    // A later, looser consumer configuration must respect the admitted ceiling.
    ingest = await startMediaWorker({
      ...process.env,
      REELCHEMY_MEDIA_SHARED_STORAGE_BYTES: String(2 * limit),
    });
    const failed = await until(() => {
      const row = app.mediaProcessing.get(receipt.id, owner);
      return row?.state === "failed" && !row.cleanupPending ? row : null;
    }, "Late shared saturation did not produce a cleaned failure receipt");
    assert.equal(failed.error, "SERVICE_STORAGE_LIMIT");
    assert.equal(failed.storage, undefined);
    assert.equal(app.getProject(p.id)!.assets?.length || 0, 0);
    assert.equal(app.sharedMediaStorage().usedBytes, limit);
    const failure = mediaFailure(failed);
    assert.equal(failure.status, 503);
    const failureBody = await failure.json();
    assert.equal(failureBody.code, "MEDIA_SERVICE_STORAGE_LIMIT");
    assert.equal("usedBytes" in failureBody, false);
    assert.equal("limitBytes" in failureBody, false);
    assert.equal("requiredBytes" in failureBody, false);
    assert.equal(
      createHash("sha256")
        .update(await readFile(filler.file))
        .digest("hex"),
      filler.hash,
    );
    const row = inspect
      .prepare("SELECT outputs,reserved_bytes FROM media_requests WHERE id=?")
      .get(receipt.id) as { outputs: string; reserved_bytes: number };
    assert.equal(row.outputs, "[]");
    assert.equal(row.reserved_bytes, 0);
    app.setProjectTrashed(fillerProject.id, true);
    app.requestOwnedProjectDeletion(fillerProject.id, other);
    const renderer = spawnTestProcess(
      process.execPath,
      ["--import", "tsx", "scripts/worker-entrypoint.ts"],
      {
        env: {
          ...process.env,
          NODE_ENV: "production",
          REELCHEMY_AUTH_DIR: "/reelchemy-test-no-auth-access",
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    children.push(renderer);
    let output = "";
    for (const stream of [renderer.stdout, renderer.stderr])
      stream?.on(
        "data",
        (bytes) => (output = (output + bytes.toString()).slice(-8000)),
      );
    await until(() => {
      if (renderer.exitCode !== null || renderer.signalCode)
        throw new Error(output || "Private render consumer exited");
      return (
        app.ownedProjectDeletion(fillerProject.id, other)?.state === "completed"
      );
    }, "Confirmed project cleanup did not reclaim the retained filler");
    await shutdownTestProcesses([renderer]);
    assert.equal(app.sharedMediaStorage().usedBytes, 0);
    const retryKey = randomUUID(),
      retry = await receiveMediaRequest(
        request(retryKey),
        owner,
        p.id,
        "upload",
      );
    assert.equal(retry.status, 202);
    const accepted = (await retry.json()).request;
    const completed = await until(() => {
      const current = app.mediaProcessing.get(accepted.id, owner);
      return current?.state === "completed" && !current.cleanupPending
        ? current
        : null;
    }, "Upload did not recover after confirmed reclamation");
    assert(completed.resultId);
    const saved = app.getProject(p.id)!;
    assert.equal(saved.assets?.length, 1);
    assert(saved.assets![0].bytes! > 0);
    // A valid upload can also lose to project-data growth after receiving bytes.
    // Keep that distinct from a malformed codec input and preserve its source.
    await ingest.stop();
    ingest = undefined;
    const metadataQueued = await receiveMediaRequest(
      request(randomUUID()),
      owner,
      p.id,
      "upload",
    );
    assert.equal(metadataQueued.status, 202);
    const metadataReceipt = (await metadataQueued.json()).request;
    const originalData = (
      inspect.prepare("SELECT data FROM projects WHERE id=?").get(p.id) as {
        data: string;
      }
    ).data;
    const padded = JSON.stringify({
      ...JSON.parse(originalData),
      retainedLegacyPadding: "x".repeat(1024 ** 2),
    });
    inspect.prepare("UPDATE projects SET data=? WHERE id=?").run(padded, p.id);
    const oldProjectLimit = process.env.REELCHEMY_PROJECT_DATA_BYTES;
    process.env.REELCHEMY_PROJECT_DATA_BYTES = String(1024 ** 2);
    try {
      ingest = await startMediaWorker();
      const metadataFailed = await until(() => {
        const current = app.mediaProcessing.get(metadataReceipt.id, owner);
        return current?.state === "failed" && !current.cleanupPending
          ? current
          : null;
      }, "Late project-data saturation was not reported safely");
      assert.equal(metadataFailed.error, "PROJECT_DATA_LIMIT");
      assert.equal(metadataFailed.storage, undefined);
      const response = mediaFailure(metadataFailed);
      assert.equal(response.status, 503);
      assert.equal((await response.json()).code, "PROJECT_STORAGE_LIMIT");
      assert.equal(
        (
          inspect.prepare("SELECT data FROM projects WHERE id=?").get(p.id) as {
            data: string;
          }
        ).data,
        padded,
      );
      assert.equal(app.sharedMediaStorage().assetCount, 1);
    } finally {
      await ingest?.stop();
      ingest = undefined;
      inspect
        .prepare("UPDATE projects SET data=? WHERE id=?")
        .run(originalData, p.id);
      if (oldProjectLimit === undefined)
        delete process.env.REELCHEMY_PROJECT_DATA_BYTES;
      else process.env.REELCHEMY_PROJECT_DATA_BYTES = oldProjectLimit;
    }
    const newFiller = app.createProject(brief, other);
    await fill(newFiller.id, limit - app.sharedMediaStorage().usedBytes);
    assert.equal(app.sharedMediaStorage().usedBytes, limit);
    const replay = await receiveMediaRequest(
      request(retryKey),
      owner,
      p.id,
      "upload",
    );
    assert.equal(replay.status, 202);
    const recovered = (await replay.json()).request;
    assert.equal(recovered.id, completed.id);
    assert.equal(recovered.state, "completed");
    const deniedKey = randomUUID(),
      denied = await receiveMediaRequest(
        request(deniedKey),
        owner,
        p.id,
        "upload",
      );
    assert.equal(denied.status, 503);
    const deniedBody = await denied.json();
    assert.equal(deniedBody.code, "MEDIA_SERVICE_STORAGE_LIMIT");
    assert.equal("usedBytes" in deniedBody, false);
    assert.equal(
      inspect
        .prepare(
          "SELECT 1 FROM media_requests WHERE workspace_id=? AND request_key=?",
        )
        .get(owner, deniedKey),
      undefined,
    );
    assert.equal(app.getProject(p.id)!.assets?.length, 1);
  },
);
