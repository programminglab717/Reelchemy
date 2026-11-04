import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, stat, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomBytes, createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import Database from "better-sqlite3";
import sharp from "sharp";
import { blankTimeline } from "../src/lib/editor";
import { measureExportFiles } from "../src/lib/export-storage-files";
import { liveNativeRenderJobs } from "../src/lib/render-attempt-processes";
import { inspectExportFiles } from "../src/lib/export-file-tree";
import {
  spawnTestProcess,
  shutdownTestProcesses,
} from "../scripts/test-process";
const hash = (value: Buffer | string) =>
  createHash("sha256").update(value).digest("hex");
test(
  "real rendering obeys its captured output ceiling despite a later increase, keeps failed bytes charged until reviewed cleanup and then renders a fresh MP4",
  { timeout: 110000 },
  async () => {
    const root = await mkdtemp(
        path.join(tmpdir(), "reelchemy-export-budget-worker-"),
      ),
      data = path.join(root, "data"),
      artifacts = path.join(root, "exports"),
      MiB = 1024 ** 2;
    Object.assign(process.env, {
      REELCHEMY_DATA_DIR: data,
      REELCHEMY_AUTH_DIR: path.join(root, "unused-auth"),
      REELCHEMY_ARTIFACT_DIR: artifacts,
      REELCHEMY_RENDER_CACHE_DIR: path.join(root, "cache"),
      REELCHEMY_EXPORT_RESERVATION_BYTES: String(MiB),
      REELCHEMY_EXPORT_STUDIO_BYTES: String(MiB),
      REELCHEMY_EXPORT_SERVICE_BYTES: String(2 * MiB),
      REELCHEMY_EXPORT_STUDIO_COUNT: "10",
      REELCHEMY_EXPORT_SERVICE_COUNT: "20",
      AI_PROVIDER: "mock",
    });
    await mkdir(artifacts, { recursive: true });
    const app = await import("../src/lib/db"),
      { storeImage } = await import("../src/lib/assets"),
      inspect = new Database(path.join(data, "studio.sqlite"));
    const children: ReturnType<typeof spawnTestProcess>[] = [];
    let output = "";
    try {
      const workspace = app.ensureWorkspace(
          "native-budget-owner",
          "Native budget",
        ).id,
        brief = {
          prompt: "Keep this saved film and original image",
          duration: 5,
          format: "landscape" as const,
        },
        initial = app.createProject(brief, workspace);
      const noise = await sharp(randomBytes(1280 * 720 * 3), {
        raw: { width: 1280, height: 720, channels: 3 },
      })
        .png()
        .toBuffer();
      const asset = await storeImage(
        noise,
        "Owned-noise.png",
        "Synthetic fixture artwork",
      );
      assert(app.appendOwnedAsset(initial.id, workspace, asset));
      const timeline = blankTimeline(brief);
      timeline.scenes[0].layers = [
        {
          ...timeline.scenes[0].layers[0],
          kind: "image",
          assetId: asset.id,
          x: 0,
          y: 0,
          width: 1,
          height: 1,
          animation: "none",
          imageFit: "cover",
        },
      ];
      const saved = app.reviseProject(
          app.getProject(initial.id)!,
          timeline,
          "Owned source film",
        ),
        sourceFile = path.join(data, "assets", asset.id),
        sourceHash = hash(await readFile(sourceFile)),
        filmHash = hash(JSON.stringify(app.getProject(saved.id))),
        job = app.createOwnedJob(saved.id, workspace)!.job;
      assert.equal(app.exportJobCeiling(job.id), MiB);
      const env: NodeJS.ProcessEnv = {
        ...process.env,
        NODE_ENV: "production",
        REELCHEMY_AUTH_DIR: "/reelchemy-budget-no-auth-access",
        REELCHEMY_EXPORT_RESERVATION_BYTES: String(64 * MiB),
        REELCHEMY_EXPORT_STUDIO_BYTES: String(64 * MiB),
        REELCHEMY_EXPORT_SERVICE_BYTES: String(128 * MiB),
      };
      for (const name of Object.keys(env))
        if (
          name.startsWith("AI_") ||
          name.startsWith("SMTP_") ||
          ["BETTER_AUTH_SECRET", "BETTER_AUTH_URL", "EMAIL_FROM"].includes(name)
        )
          delete env[name];
      const worker = spawnTestProcess(
        process.execPath,
        ["--import", "tsx", "scripts/worker-entrypoint.ts"],
        { env, stdio: ["ignore", "pipe", "pipe"] },
      );
      children.push(worker);
      for (const stream of [worker.stdout, worker.stderr])
        stream?.on("data", (bytes) => {
          output = (output + bytes.toString()).slice(-16000);
        });
      async function wait<T>(
        read: () => T | Promise<T>,
        message: string,
        milliseconds = 70000,
      ): Promise<NonNullable<T>> {
        const end = Date.now() + milliseconds;
        while (Date.now() < end) {
          if (worker.exitCode !== null || worker.signalCode)
            throw new Error(`Consumer exited: ${output}`);
          const value = await read();
          if (value) return value as NonNullable<T>;
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
        throw new Error(`${message}: ${output}`);
      }
      await wait(
        () =>
          app.getJob(job.id)?.status === "failed" &&
          !inspect
            .prepare("SELECT 1 FROM render_job_attempts WHERE job_id=?")
            .get(job.id),
        "Oversized genuine render did not finish its native teardown",
      );
      const failed = app.getJob(job.id)!;
      assert.match(failed.error!, /exceeded its file allowance/);
      assert.equal(failed.retryCount ?? 0, 0);
      assert(!output.includes('"event":"render.retry"'));
      assert.equal((await liveNativeRenderJobs(data)).size, 0);
      const actual = await measureExportFiles(artifacts, job.id);
      assert(actual.bytes > MiB);
      assert(actual.files > 0);
      assert.equal(app.exportStorage(workspace).usedBytes, actual.bytes);
      assert.equal(app.exportStorage(workspace).reservedBytes, 0);
      assert.equal(app.jobHistoryStorage(workspace).reservedBytes, 0);
      assert.equal(app.jobHistoryStorage(workspace).pendingJobs, 0);
      assert.throws(
        () => app.createOwnedJob(saved.id, workspace),
        /retained export allowance is full/,
      );
      const lifecycle = await stat(path.join(data, "worker.lifecycle.lock"));
      const review = await inspectExportFiles(artifacts, {
        jobId: job.id,
        projectId: saved.id,
        workspaceId: workspace,
      });
      assert(app.requestExportFiles(review));
      assert.equal(app.exportStorage(workspace).usedBytes, actual.bytes);
      await wait(
        () => app.exportFileRemoval(job.id, workspace)?.state === "completed",
        "Reviewed failed output was not removed",
        15000,
      );
      assert.equal(app.exportStorage(workspace).usedBytes, 0);
      assert.equal(app.exportStorage(workspace).retainedExports, 0);
      assert.equal(hash(await readFile(sourceFile)), sourceHash);
      assert.equal(hash(JSON.stringify(app.getProject(saved.id))), filmHash);
      // A new admission may capture the newly configured allowance; the old
      // oversized job above must still have respected its original 1 MiB hold.
      Object.assign(process.env, {
        REELCHEMY_EXPORT_RESERVATION_BYTES: String(64 * MiB),
        REELCHEMY_EXPORT_STUDIO_BYTES: String(64 * MiB),
        REELCHEMY_EXPORT_SERVICE_BYTES: String(128 * MiB),
      });
      const small = app.reviseProject(
          app.createProject(brief, workspace),
          blankTimeline(brief),
          "Fresh simple film",
        ),
        next = app.createOwnedJob(small.id, workspace)!.job;
      assert.equal(app.exportJobCeiling(next.id), 64 * MiB);
      await wait(() => {
        const current = app.getJob(next.id)!;
        if (current.status === "failed")
          throw new Error(`Fresh export failed: ${current.error}: ${output}`);
        return (
          current.status === "completed" &&
          !inspect
            .prepare("SELECT 1 FROM render_job_attempts WHERE job_id=?")
            .get(next.id)
        );
      }, "Fresh export did not complete after cleanup");
      const video = path.join(artifacts, next.id, "video.mp4"),
        probe = JSON.parse(
          execFileSync(
            "ffprobe",
            [
              "-v",
              "error",
              "-select_streams",
              "v:0",
              "-show_entries",
              "stream=codec_name,width,height",
              "-of",
              "json",
              video,
            ],
            { encoding: "utf8", timeout: 10000 },
          ),
        );
      assert.equal(probe.streams[0].codec_name, "h264");
      assert.equal(probe.streams[0].width, 1280);
      assert.equal(probe.streams[0].height, 720);
      execFileSync(
        "ffmpeg",
        ["-v", "error", "-xerror", "-i", video, "-f", "null", "-"],
        { timeout: 10000 },
      );
      const final = await measureExportFiles(artifacts, next.id);
      assert.equal(app.jobHistoryStorage(workspace).reservedBytes, 0);
      assert.equal(app.jobHistoryStorage(workspace).pendingJobs, 0);
      assert(final.bytes <= 64 * MiB);
      assert.equal(app.exportStorage(workspace).usedBytes, final.bytes);
      assert.equal(app.exportStorage(workspace).reservedBytes, 0);
      assert.equal(
        (await stat(path.join(data, "worker.lifecycle.lock"))).ino,
        lifecycle.ino,
      );
      assert.equal(hash(await readFile(sourceFile)), sourceHash);
      assert.equal(hash(JSON.stringify(app.getProject(saved.id))), filmHash);
      assert.equal((await liveNativeRenderJobs(data)).size, 0);
    } catch (error) {
      console.error(
        JSON.stringify({ event: "export.budget.native.fixture", output }),
      );
      throw error;
    } finally {
      await shutdownTestProcesses(children);
      inspect.close();
      await rm(root, { recursive: true, force: true });
    }
  },
);
