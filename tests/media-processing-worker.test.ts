import { test, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  rm,
  readFile,
  writeFile,
  stat,
  readdir,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { execFileSync, type ChildProcess } from "node:child_process";
import Database from "better-sqlite3";
import sharp from "sharp";
import {
  spawnTestProcess,
  shutdownTestProcesses,
} from "../scripts/test-process";
import {
  mediaInputFingerprint,
  type MediaInput,
} from "../src/lib/media-processing-store";
import { cachedWaveform, cacheWaveform } from "../src/lib/waveform-cache";
import { MediaProcessingUnavailable } from "../src/lib/media-processing-policy";

const root = await mkdtemp(path.join(tmpdir(), "reelchemy-ingest-worker-"));
process.env.REELCHEMY_DATA_DIR = path.join(root, "data");
// Importing/operating this role must not need to create an artifact directory.
process.env.REELCHEMY_ARTIFACT_DIR = "/reelchemy-test-no-artifact-access";
process.env.REELCHEMY_AUTH_DIR = "/reelchemy-test-no-auth-access";
const app = await import("../src/lib/db");
const { exportArchive } = await import("../src/lib/archive");
const admin = new Database(path.join(root, "data", "studio.sqlite"));
const workspace = app.ensureWorkspace(
  "private-media-worker-owner",
  "Worker fixture",
).id;
const children: ChildProcess[] = [];
let worker: ChildProcess | undefined;
after(async () => {
  await shutdownTestProcesses(children);
  admin.close();
  await rm(root, { recursive: true, force: true });
});
function project() {
  return app.createProject(
    { prompt: "Private worker fixture", duration: 5, format: "landscape" },
    workspace,
  );
}
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(
  check: () => boolean | Promise<boolean>,
  label: string,
  ms = 20000,
) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (await check()) return;
    await delay(20);
  }
  assert.fail(label);
}
async function start() {
  let output = "";
  worker = spawnTestProcess(
    process.execPath,
    ["--import", "tsx", "scripts/ingest-entrypoint.ts"],
    { env: { ...process.env }, stdio: ["ignore", "pipe", "pipe"] },
  );
  children.push(worker);
  worker.stdout!.on("data", (data) => {
    output = (output + data).slice(-8000);
  });
  worker.stderr!.on("data", (data) => {
    output = (output + data).slice(-8000);
  });
  await until(() => {
    assert.equal(worker!.exitCode, null, output);
    return output.includes("Reelchemy media worker ready");
  }, "Media worker did not become ready");
  return worker;
}
async function stop() {
  if (worker) await shutdownTestProcesses([worker]);
  worker = undefined;
}
afterEach(async () => {
  await stop();
  // The worker has stopped before fixture-only cleanup; a failed assertion must
  // not leave a native process or pending admission behind for the next case.
  const pending = admin
    .prepare(
      "SELECT id FROM media_requests WHERE state IN ('receiving','queued','working','cancelling')",
    )
    .all() as { id: string }[];
  for (const row of pending) {
    admin
      .prepare(
        "UPDATE media_requests SET state='cancelled',token=NULL WHERE id=?",
      )
      .run(row.id);
    app.cleanupMediaRequest(row.id);
  }
});
async function image(width = 64, height = 32) {
  return sharp({
    create: { width, height, channels: 3, background: "#f4c44a" },
  })
    .png()
    .toBuffer();
}
function enqueue(
  projectId: string | null,
  bytes: Uint8Array,
  details: { kind: "image" | "audio" | "video"; name: string } | null,
) {
  const input: MediaInput = details
    ? {
        operation: "upload",
        ...details,
        license: "Generated private worker fixture",
        bytes: bytes.length,
        sha256: createHash("sha256").update(bytes).digest("hex"),
      }
    : {
        operation: "import",
        bytes: bytes.length,
        sha256: createHash("sha256").update(bytes).digest("hex"),
      };
  const r = app.mediaProcessing.reserve({
    workspaceId: workspace,
    projectId,
    operation: input.operation,
    requestKey: randomUUID(),
    fingerprint: mediaInputFingerprint(input),
  });
  assert.ok(r.created);
  app.mediaProcessing.enqueue(r.receipt.id, r.token, input, () =>
    app.mediaInputs.write(r.receipt.id, bytes, 50 * 1024 * 1024, input.sha256),
  );
  return r.receipt.id;
}
async function completed(id: string, state = "completed") {
  await until(
    () => app.mediaProcessing.get(id, workspace)?.state === state,
    `Media job did not become ${state}`,
  );
  await until(
    () =>
      (
        admin
          .prepare(
            "SELECT reserved_bytes,outputs FROM media_requests WHERE id=?",
          )
          .get(id) as { reserved_bytes: number; outputs: string }
      ).reserved_bytes === 0,
    "Raw media reservation was not cleaned",
  );
  return app.mediaProcessing.get(id, workspace)!;
}

test("real private image ingestion uses its worker, retains exact rights and excludes duplicate workers", async () => {
  const p = project(),
    bytes = await image();
  const id = enqueue(p.id, bytes, { kind: "image", name: "Brand badge.png" });
  assert.equal(app.getProject(p.id)?.assets?.length || 0, 0);
  await start();
  const result = await completed(id);
  const asset = app.getProject(p.id)!.assets![0];
  assert.equal(result.resultId, asset.id);
  assert.equal(asset.name, "Brand badge.png");
  assert.equal(asset.license, "Generated private worker fixture");
  assert.equal(asset.width, 64);
  assert.deepEqual(
    await readFile(path.join(root, "data", "assets", asset.id)),
    bytes,
  );
  assert.deepEqual(await readdir(path.join(root, "data", "media-inputs")), []);
  const lifecycle = path.join(root, "data", "ingest.lifecycle.lock"),
    inode = (await stat(lifecycle)).ino;
  let duplicateOutput = "";
  const duplicate = spawnTestProcess(
    process.execPath,
    ["--import", "tsx", "scripts/ingest-entrypoint.ts"],
    { env: { ...process.env }, stdio: ["ignore", "pipe", "pipe"] },
  );
  children.push(duplicate);
  duplicate.stderr!.on("data", (data) => {
    duplicateOutput += data;
  });
  const code = await new Promise((resolve) => duplicate.once("close", resolve));
  assert.equal(code, 1);
  assert.match(duplicateOutput, /Another media worker/);
  await stop();
  assert.equal((await stat(lifecycle)).ino, inode);
  await assert.rejects(() => stat(path.join(root, "data", "ingest.lock")), {
    code: "ENOENT",
  });
  await start();
  assert.equal((await stat(lifecycle)).ino, inode);
});

test("actual audio normalization and portable import precompute durable waveforms", async () => {
  const source = path.join(root, "tone.wav");
  execFileSync("ffmpeg", [
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=440:duration=1",
    "-threads",
    "1",
    source,
  ]);
  const p = project(),
    id = enqueue(p.id, await readFile(source), {
      kind: "audio",
      name: "Voice.wav",
    });
  await start();
  const done = await completed(id);
  const waveform = cachedWaveform(done.resultId!);
  assert.equal(waveform?.fps, 30);
  assert.equal(waveform?.peaks.length, 30);
  // The mono sine's 0.125 amplitude becomes ~0.088 in each stereo channel.
  assert.ok(waveform.peaks.some((value) => value > 0.08 && value < 0.1));
  const archive = await exportArchive(app.getProject(p.id)!);
  const imported = await completed(enqueue(null, archive, null));
  const restored = app.getProject(imported.resultId!)!;
  assert.ok(restored.name.endsWith("(imported)"));
  assert.notEqual(restored.assets![0].id, done.resultId);
  assert.deepEqual(cachedWaveform(restored.assets![0].id), waveform);
  assert.equal(app.projectInWorkspace(restored.id, workspace), true);
  await stop();
});

test("a real interrupted attempt cleans its registered outputs and retries once under a fresh token", async () => {
  const p = project(),
    id = enqueue(p.id, await image(), {
      kind: "image",
      name: "Crash fixture.png",
    });
  const first = app.mediaProcessing.claim()!,
    orphan = randomUUID();
  assert.equal(first.id, id);
  app.mediaProcessing.recordOutputs(first, [orphan]);
  await writeFile(
    path.join(root, "data", "assets", orphan),
    "Uncommitted prior output",
  );
  cacheWaveform(orphan, { fps: 30, peaks: [0.2] });
  await start();
  const done = await completed(id);
  assert.notEqual(done.resultId, orphan);
  assert.equal(
    (
      admin
        .prepare("SELECT attempts FROM media_requests WHERE id=?")
        .get(id) as { attempts: number }
    ).attempts,
    2,
  );
  await assert.rejects(() => stat(path.join(root, "data", "assets", orphan)), {
    code: "ENOENT",
  });
  assert.equal(cachedWaveform(orphan), undefined);
  assert.throws(
    () => app.mediaProcessing.finish(first, () => orphan),
    MediaProcessingUnavailable,
  );
  assert.equal(app.getProject(p.id)!.assets!.length, 1);
  await stop();

  const failedId = enqueue(p.id, await image(), {
    kind: "image",
    name: "Two interruptions.png",
  });
  const second = app.mediaProcessing.claim()!;
  assert.equal(
    app.mediaProcessing.retryInterrupted(
      second,
      app.cleanupUnreferencedMediaOutputs,
    ),
    true,
  );
  const last = app.mediaProcessing.claim()!;
  assert.equal(last.attempts, 2);
  await start();
  const failed = await completed(failedId, "failed");
  assert.equal(failed.error, "INTERRUPTED");
  assert.equal(app.getProject(p.id)!.assets!.length, 1);
  await stop();
});

test("SIGKILL during real native decoding is recovered once without duplicating an attachment", async () => {
  const p = project(),
    id = enqueue(p.id, await image(5000, 3000), {
      kind: "image",
      name: "Killed native decode.png",
    });
  await start();
  let outputId = "";
  await until(() => {
    const row = admin
      .prepare("SELECT state,outputs FROM media_requests WHERE id=?")
      .get(id) as { state: string; outputs: string };
    if (row.state !== "working" || row.outputs === "[]") return false;
    outputId = JSON.parse(row.outputs)[0];
    return true;
  }, "Did not observe native decode before crash");
  const diagnostic = JSON.parse(
    await readFile(path.join(root, "data", "ingest.lock"), "utf8"),
  );
  assert.equal(diagnostic.kind, "reelchemy-ingest-lock-v1");
  assert.ok(Number.isInteger(diagnostic.pid) && diagnostic.pid > 1);
  process.kill(diagnostic.pid, "SIGKILL");
  await until(
    () => worker!.exitCode !== null,
    "Managed ingestion entrypoint did not exit after SIGKILL",
  );
  assert.equal(worker!.exitCode, 1);
  await stop();
  assert.equal(app.mediaProcessing.get(id, workspace)?.state, "working");
  await start();
  const done = await completed(id);
  assert.notEqual(done.resultId, outputId);
  assert.equal(app.getProject(p.id)!.assets!.length, 1);
  assert.equal(
    (
      admin
        .prepare("SELECT attempts FROM media_requests WHERE id=?")
        .get(id) as { attempts: number }
    ).attempts,
    2,
  );
  await assert.rejects(
    () => stat(path.join(root, "data", "assets", outputId)),
    { code: "ENOENT" },
  );
});

test("Trash during actual image decoding cancels late attachment and permits a later successful upload", async () => {
  const p = project(),
    id = enqueue(p.id, await image(5000, 3000), {
      kind: "image",
      name: "Large cancellation.png",
    });
  await start();
  await until(() => {
    const row = admin
      .prepare("SELECT state,outputs FROM media_requests WHERE id=?")
      .get(id) as { state: string; outputs: string };
    return row.state === "working" && row.outputs !== "[]";
  }, "Did not observe real image normalization in flight");
  app.setProjectTrashed(p.id, true);
  await completed(id, "cancelled");
  assert.equal(app.getProject(p.id)?.assets?.length || 0, 0);
  assert.equal(app.mediaProcessing.projectBusy(p.id), false);
  app.setProjectTrashed(p.id, false);
  await completed(
    enqueue(p.id, await image(), {
      kind: "image",
      name: "After cancellation.png",
    }),
  );
  assert.equal(app.getProject(p.id)!.assets!.length, 1);
  await stop();
});

test("permanent removal waits for receiver acknowledgment without blocking another project", async () => {
  const p = project(),
    other = project();
  const receiver = app.mediaProcessing.reserve({
    workspaceId: workspace,
    projectId: p.id,
    operation: "upload",
    requestKey: randomUUID(),
  });
  assert.ok(receiver.created);
  app.setProjectTrashed(p.id, true);
  app.requestOwnedProjectDeletion(p.id, workspace);
  assert.equal(app.claimProjectDeletion(), undefined);
  app.setProjectTrashed(other.id, true);
  app.requestOwnedProjectDeletion(other.id, workspace);
  const unblocked = app.claimProjectDeletion()!;
  assert.equal(unblocked.projectId, other.id);
  app.finishProjectDeletion(unblocked);
  app.mediaProcessing.abandonReceiver(receiver.receipt.id, receiver.token);
  assert.equal(app.claimProjectDeletion(), undefined); // Raw reservation remains.
  app.cleanupMediaRequest(receiver.receipt.id);
  const task = app.claimProjectDeletion()!;
  assert.equal(task.projectId, p.id);
  app.finishProjectDeletion(task);
  assert.equal(
    app.mediaProcessing.get(receiver.receipt.id, workspace),
    undefined,
  );
});
