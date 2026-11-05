import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  stat,
  rm,
  access,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import Database from "better-sqlite3";
import { blankTimeline } from "../src/lib/editor";
import { timelineSchema, totalFrames } from "../src/lib/schema";
import { liveNativeRenderJobs } from "../src/lib/render-attempt-processes";
import { HEARTBEAT_NAME } from "../src/lib/worker-heartbeat";
import {
  spawnTestProcess,
  shutdownTestProcesses,
} from "../scripts/test-process";
const hash = (value: Buffer | string) =>
  createHash("sha256").update(value).digest("hex");
const MiB = 1024 ** 2;

// A complete five-minute portrait native-HD motion film needs far longer than
// the smallest operator budget. The real consumer must stop at its captured
// deadline, tear down its native browser/encoder processes, refuse automatic
// retry, keep saved work, allowances and permanent lifecycle state, and then
// render later exports — before and after a restart that restores automatic
// duration-based budgets.
test(
  "a real consumer enforces its captured attempt deadline, tears down native work without retrying and recovers into later exports across a restart",
  { timeout: 330000 },
  async () => {
    const root = await mkdtemp(
        path.join(tmpdir(), "reelchemy-render-deadline-worker-"),
      ),
      data = path.join(root, "data"),
      artifacts = path.join(root, "exports");
    Object.assign(process.env, {
      REELCHEMY_DATA_DIR: data,
      REELCHEMY_AUTH_DIR: path.join(root, "unused-auth"),
      REELCHEMY_ARTIFACT_DIR: artifacts,
      REELCHEMY_RENDER_CACHE_DIR: path.join(root, "cache"),
      REELCHEMY_EXPORT_RESERVATION_BYTES: String(256 * MiB),
      REELCHEMY_EXPORT_STUDIO_BYTES: String(1024 * MiB),
      REELCHEMY_EXPORT_SERVICE_BYTES: String(2048 * MiB),
      REELCHEMY_EXPORT_STUDIO_COUNT: "10",
      REELCHEMY_EXPORT_SERVICE_COUNT: "20",
      REELCHEMY_ACTIVE_EXPORTS_PER_STUDIO: "4",
      AI_PROVIDER: "mock",
    });
    await mkdir(artifacts, { recursive: true });
    const app = await import("../src/lib/db"),
      inspect = new Database(path.join(data, "studio.sqlite"));
    const children: ReturnType<typeof spawnTestProcess>[] = [];
    let output = "";
    try {
      const workspace = app.ensureWorkspace(
        "deadline-owner",
        "Deadline studio",
      ).id;
      // Long film: fifteen twenty-second portrait scenes of continuous
      // procedural node motion at native HD — 9,000 frames.
      const longBrief = {
        prompt: "Keep this long motion film intact",
        duration: 20,
        format: "portrait" as const,
      };
      const longTimeline = blankTimeline({ ...longBrief, duration: 300 });
      longTimeline.exportResolution = "1080p";
      longTimeline.scenes = longTimeline.scenes.map((scene, i) => {
        const title = {
          ...scene.layers[0],
          text: `Section ${i + 1}`,
          y: 0.05,
          height: 0.12,
          fontSize: 40,
        };
        return {
          ...scene,
          layers: [
            title,
            {
              ...title,
              id: "visual",
              kind: "nodes" as const,
              text: "",
              x: 0.08,
              y: 0.22,
              width: 0.84,
              height: 0.5,
              color: "#d5f281",
            },
          ],
        };
      });
      const parsedLong = timelineSchema.parse(longTimeline);
      assert.equal(totalFrames(parsedLong), 9000);
      const long = app.reviseProject(
          app.createProject(longBrief, workspace),
          parsedLong,
          "Five-minute motion film",
        ),
        longHash = hash(JSON.stringify(app.getProject(long.id)));
      const shortBrief = {
        prompt: "A short follow-up film",
        duration: 5,
        format: "landscape" as const,
      };
      const short = app.reviseProject(
          app.createProject(shortBrief, workspace),
          blankTimeline(shortBrief),
          "Short follow-up film",
        ),
        shortHash = hash(JSON.stringify(app.getProject(short.id)));
      const baseEnv: NodeJS.ProcessEnv = {
        ...process.env,
        NODE_ENV: "production",
        REELCHEMY_AUTH_DIR: "/reelchemy-deadline-no-auth-access",
      };
      for (const name of Object.keys(baseEnv))
        if (
          name.startsWith("AI_") ||
          name.startsWith("SMTP_") ||
          ["BETTER_AUTH_SECRET", "BETTER_AUTH_URL", "EMAIL_FROM"].includes(name)
        )
          delete baseEnv[name];
      let worker: ReturnType<typeof spawnTestProcess>;
      const start = (budget: string) => {
        worker = spawnTestProcess(
          process.execPath,
          ["--import", "tsx", "scripts/worker-entrypoint.ts"],
          {
            env: { ...baseEnv, RENDER_JOB_TIMEOUT_MS: budget },
            stdio: ["ignore", "pipe", "pipe"],
          },
        );
        children.push(worker);
        for (const stream of [worker.stdout, worker.stderr])
          stream?.on("data", (bytes) => {
            output = (output + bytes.toString()).slice(-24000);
          });
      };
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
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
        throw new Error(`${message}: ${output}`);
      }
      const attemptOpen = (id: string) =>
        !!inspect
          .prepare("SELECT 1 FROM render_job_attempts WHERE job_id=?")
          .get(id);
      const started = (id: string) => {
        const match = output.match(
          new RegExp(`\\{"event":"render\\.start","jobId":"${id}"[^}]*\\}`),
        );
        return match ? (JSON.parse(match[0]) as { budgetMs: number }) : null;
      };
      async function completes(id: string) {
        await wait(
          () => {
            const current = app.getJob(id)!;
            if (current.status === "failed")
              throw new Error(`Export failed: ${current.error}: ${output}`);
            return current.status === "completed" && !attemptOpen(id);
          },
          "Follow-up export did not complete",
          110000,
        );
        const video = path.join(artifacts, id, "video.mp4"),
          probe = JSON.parse(
            execFileSync(
              "ffprobe",
              [
                "-v",
                "error",
                "-select_streams",
                "v:0",
                "-show_entries",
                "stream=codec_name,width,height,nb_frames",
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
        assert.equal(Number(probe.streams[0].nb_frames), 150);
        execFileSync(
          "ffmpeg",
          ["-v", "error", "-xerror", "-i", video, "-f", "null", "-"],
          { timeout: 20000 },
        );
      }

      // An explicit operator value of 1 ms is clamped to the 60-second floor.
      start("1");
      const job = app.createOwnedJob(long.id, workspace)!.job;
      await wait(() => started(job.id), "Long export did not start", 90000);
      assert.equal(started(job.id)!.budgetMs, 60000);
      const startedAt = Date.now();
      const lifecycle = await stat(path.join(data, "worker.lifecycle.lock"));
      // The attempt owns genuine native browser/encoder processes before its
      // deadline; the teardown below is therefore observable, not vacuous.
      await wait(
        async () => (await liveNativeRenderJobs(data)).has(job.id),
        "Long export never owned native processes",
        55000,
      );
      assert.equal(app.getJob(job.id)!.status, "rendering");
      await wait(
        () => app.getJob(job.id)?.status === "failed" && !attemptOpen(job.id),
        "Deadline did not stop and close the long attempt",
        120000,
      );
      const elapsed = Date.now() - startedAt;
      const failed = app.getJob(job.id)!;
      assert.match(failed.error!, /exceeded its total time limit/);
      assert.match(failed.error!, /shorter film/);
      assert.equal(failed.retryCount ?? 0, 0);
      assert(failed.progress < 1, "The long film must not have completed");
      // Started at most a poll interval after the real claim; the deadline is
      // honoured and teardown is bounded rather than running to completion.
      assert(elapsed >= 59000, `Deadline fired early after ${elapsed} ms`);
      assert(elapsed < 60000 + 45000, `Teardown took ${elapsed} ms`);
      assert(!output.includes('"event":"render.retry"'));
      assert.match(output, /"event":"render\.failed"/);
      assert.equal((await liveNativeRenderJobs(data)).size, 0);
      await assert.rejects(() =>
        access(path.join(artifacts, job.id, "video.mp4")),
      );
      // The abandoned scene's unpublished cache staging is removed too.
      const cacheNames = await readdir(path.join(root, "cache"), {
        recursive: true,
      }).catch(() => [] as string[]);
      assert(
        !cacheNames.some((name) => path.basename(name).startsWith(".partial-")),
        `Unpublished scene staging remains: ${cacheNames.join(", ")}`,
      );
      assert.equal(app.exportStorage(workspace).reservedBytes, 0);
      assert.equal(app.jobHistoryStorage(workspace).reservedBytes, 0);
      assert.equal(app.jobHistoryStorage(workspace).pendingJobs, 0);
      assert.equal(hash(JSON.stringify(app.getProject(long.id))), longHash);
      // The same consumer keeps running with a fresh heartbeat.
      assert.equal(worker!.exitCode, null);
      const heartbeat = JSON.parse(
        await readFile(path.join(data, HEARTBEAT_NAME), "utf8"),
      ) as { at: string; ready: boolean };
      assert(Date.now() - Date.parse(heartbeat.at) < 15000);

      // Subsequent export from the same consumer after native teardown.
      const next = app.createOwnedJob(short.id, workspace)!.job;
      await completes(next.id);
      assert.equal(started(next.id)!.budgetMs, 60000);

      // Operator restart applies a changed (now automatic) setting while the
      // permanent lifecycle inode and saved work remain untouched.
      await shutdownTestProcesses([worker!]);
      await assert.rejects(() => access(path.join(data, "worker.lock")));
      start("");
      const after = app.createOwnedJob(short.id, workspace)!.job;
      await completes(after.id);
      assert.equal(started(after.id)!.budgetMs, 600000);
      assert.equal(
        (await stat(path.join(data, "worker.lifecycle.lock"))).ino,
        lifecycle.ino,
      );
      assert.equal(app.getJob(job.id)!.status, "failed");
      assert.equal(hash(JSON.stringify(app.getProject(long.id))), longHash);
      assert.equal(hash(JSON.stringify(app.getProject(short.id))), shortHash);
      assert.equal((await liveNativeRenderJobs(data)).size, 0);
      assert.equal(app.exportStorage(workspace).reservedBytes, 0);
      assert.equal(app.jobHistoryStorage(workspace).pendingJobs, 0);
    } catch (error) {
      console.error(
        JSON.stringify({ event: "render.deadline.fixture", output }),
      );
      throw error;
    } finally {
      await shutdownTestProcesses(children);
      inspect.close();
      await rm(root, { recursive: true, force: true });
    }
  },
);
