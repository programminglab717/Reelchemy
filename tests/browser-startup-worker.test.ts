import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, stat, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { once } from "node:events";
import {
  renderJobMarker,
  renderRootMarker,
} from "../src/lib/render-attempt-processes";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import Database from "better-sqlite3";
import { blankTimeline } from "../src/lib/editor";
import { recentHeartbeat } from "../src/lib/worker-heartbeat";
import {
  spawnTestProcess,
  shutdownTestProcesses,
} from "../scripts/test-process";
const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
test(
  "the real consumer cleans a genuine failed browser launch, retries once and completes an MP4 without changing the saved film or lifecycle inode",
  { timeout: 115000 },
  async () => {
    const root = await mkdtemp(
        path.join(tmpdir(), "reelchemy-startup-worker-"),
      ),
      data = path.join(root, "data"),
      artifacts = path.join(root, "exports"),
      marker = path.join(root, "stalled-once"),
      pidFile = path.join(root, "stalled-pid"),
      fake = path.join(root, "chrome-with-one-stall"),
      actual = process.env.CHROMIUM_PATH || "/usr/bin/chromium";
    Object.assign(process.env, {
      REELCHEMY_DATA_DIR: data,
      REELCHEMY_ARTIFACT_DIR: artifacts,
      REELCHEMY_AUTH_DIR: path.join(root, "private-unused-auth"),
      REELCHEMY_RENDER_CACHE_DIR: path.join(root, "cache"),
      AI_PROVIDER: "mock",
    });
    const app = await import("../src/lib/db"),
      inspect = new Database(path.join(data, "studio.sqlite"));
    const workspace = app.ensureWorkspace(
        "startup-recovery-owner",
        "Startup recovery",
      ).id,
      brief = {
        prompt: "Keep the saved film during startup retry",
        duration: 5,
        format: "landscape" as const,
      },
      saved = app.reviseProject(
        app.createProject(brief, workspace),
        blankTimeline(brief),
        "Initial",
      );
    const projectHash = () =>
      createHash("sha256")
        .update(
          (
            inspect
              .prepare("SELECT data FROM projects WHERE id=?")
              .get(saved.id) as { data: string }
          ).data,
        )
        .digest("hex");
    const before = projectHash();
    await writeFile(
      fake,
      [
        "#!/bin/sh",
        "is_remotion=0",
        "for argument do",
        'case "$argument" in --remotion-shared-memory-capture) is_remotion=1 ;; esac',
        "done",
        `if [ "$is_remotion" = 1 ] && (set -C; : > ${quote(marker)}) 2>/dev/null; then`,
        `  printf '%s' "$$" > ${quote(pidFile)}`,
        "  exec sleep 120",
        "fi",
        `exec ${quote(actual)} "$@"`,
        "",
      ].join("\n"),
      { mode: 0o700, flag: "wx" },
    );
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      NODE_ENV: "production",
      CHROMIUM_PATH: fake,
      REELCHEMY_AUTH_DIR: "/reelchemy-startup-no-auth-access",
    };
    for (const name of Object.keys(env))
      if (
        name.startsWith("AI_") ||
        name.startsWith("SMTP_") ||
        ["BETTER_AUTH_SECRET", "BETTER_AUTH_URL", "EMAIL_FROM"].includes(name)
      )
        delete env[name];
    const interrupted = app.createOwnedJob(saved.id, workspace)!.job;
    app.claimJob();
    app.updateJob(interrupted.id, { status: "cancelled" });
    const surviving = spawnTestProcess(
      process.execPath,
      ["-e", "process.stdout.write('ready\\n');setInterval(()=>{},1000)"],
      {
        env: {
          ...env,
          [renderJobMarker]: interrupted.id,
          [renderRootMarker]: data,
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    await once(surviving.stdout!, "data");
    const worker = spawnTestProcess(
      process.execPath,
      ["--import", "tsx", "scripts/worker-entrypoint.ts"],
      { env, stdio: ["ignore", "pipe", "pipe"] },
    );
    let output = "",
      currentJobId: string | undefined,
      finished = false;
    const diagnostic = () => {
      const current = currentJobId ? app.getJob(currentJobId) : undefined;
      console.error(
        JSON.stringify({
          event: "startup.recovery.fixture",
          job: current
            ? {
                id: current.id,
                status: current.status,
                stage: current.stage,
                retryCount: current.retryCount,
                error: current.error,
              }
            : null,
          output,
        }),
      );
    };
    for (const stream of [worker.stdout, worker.stderr])
      stream?.on("data", (bytes) => {
        output = (output + bytes.toString()).slice(-12000);
      });
    async function wait<T>(
      read: () => T | Promise<T>,
      message: string,
      timeout = 90000,
    ): Promise<NonNullable<T>> {
      const deadline = Date.now() + timeout;
      while (Date.now() < deadline) {
        if (worker.exitCode !== null || worker.signalCode)
          throw new Error(`Private recovery consumer exited: ${output}`);
        const result = await read();
        if (result) return result as NonNullable<T>;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      diagnostic();
      throw new Error(`${message}: ${output}`);
    }
    let lifecycle: Awaited<ReturnType<typeof stat>> | undefined;
    try {
      await wait(
        () => output.includes("PREVIOUS_NATIVE_ATTEMPT_ACTIVE"),
        "Consumer did not wait for its interrupted native attempt",
        15000,
      );
      assert.equal(
        (
          inspect
            .prepare(
              "SELECT count(*) AS n FROM render_job_attempts WHERE job_id=?",
            )
            .get(interrupted.id) as { n: number }
        ).n,
        1,
      );
      assert.equal(
        JSON.parse(
          await readFile(path.join(data, "worker-heartbeat.json"), "utf8"),
        ).ready,
        false,
      );
      assert.throws(
        () => app.ownedExportFileSource(interrupted.id, workspace),
        /cancellation to finish/,
      );
      await shutdownTestProcesses([surviving]);
      await wait(
        async () =>
          recentHeartbeat(
            await readFile(path.join(data, "worker-heartbeat.json"), "utf8")
              .then(JSON.parse)
              .catch(() => null),
          ),
        "Recovery consumer did not become ready",
        15000,
      );
      lifecycle = await stat(path.join(data, "worker.lifecycle.lock"));
      const job = app.createOwnedJob(saved.id, workspace)!.job;
      currentJobId = job.id;
      const completed = await wait(() => {
        const current = app.getJob(job.id)!;
        if (current.status === "failed")
          throw new Error(`Recovery export failed: ${current.error}`);
        return current.status === "completed" ? current : null;
      }, "Recovery export did not complete");
      assert.equal(completed.retryCount, 1);
      assert.equal(
        completed.events?.filter((event) => event.stage === "Retry").length,
        1,
      );
      assert(output.includes('"event":"render.retry"'));
      const pid = Number(await readFile(pidFile, "utf8"));
      const running = await readFile(`/proc/${pid}/stat`, "utf8").then(
        (value) =>
          !["Z", "X"].includes(
            value.slice(value.lastIndexOf(")") + 2).split(" ")[0],
          ),
        () => false,
      );
      assert.equal(running, false);
      assert.equal(projectHash(), before);
      const file = path.join(artifacts, job.id, "video.mp4");
      const probe = JSON.parse(
        execFileSync(
          "ffprobe",
          [
            "-v",
            "error",
            "-select_streams",
            "v:0",
            "-show_entries",
            "stream=codec_name,width,height",
            "-show_entries",
            "format=duration",
            "-of",
            "json",
            file,
          ],
          { encoding: "utf8", timeout: 10000 },
        ),
      );
      assert.equal(probe.streams[0].codec_name, "h264");
      assert.equal(probe.streams[0].width, 1280);
      assert.equal(probe.streams[0].height, 720);
      assert(Math.abs(Number(probe.format.duration) - 5) < 0.1);
      assert((await stat(file)).size > 1000);
      finished = true;
    } finally {
      if (!finished) diagnostic();
      await shutdownTestProcesses([worker, surviving]);
      try {
        if (lifecycle)
          assert.equal(
            (await stat(path.join(data, "worker.lifecycle.lock"))).ino,
            lifecycle.ino,
          );
      } finally {
        inspect.close();
        await rm(root, { recursive: true, force: true });
      }
    }
  },
);
