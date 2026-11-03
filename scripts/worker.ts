import { open, unlink, writeFile, rename, readFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  artifactDir,
  dataDir,
  claimJob,
  finishJobAttempt,
  getJob,
  updateJob,
  recoverJobs,
  retryJob,
  recordJobStage,
  workspaceForProject,
} from "../src/lib/db";
import { cacheRetentionPolicy } from "../src/lib/cache-retention-policy";
import { maintainSceneCache } from "../src/lib/cache-retention";
import { HEARTBEAT_NAME } from "../src/lib/worker-heartbeat";
import { RenderQCError } from "../src/lib/layout-qc";
import { transientRenderError } from "../src/lib/retry";
import { renderFilm } from "../src/lib/render";
import { preparedRenderer } from "../src/lib/prepared-renderer";
import { processExportFileRemoval } from "../src/lib/export-file-cleanup";
import {
  liveNativeRenderJobs,
  RenderProcessInspectionError,
  renderJobMarker,
  renderRootMarker,
} from "../src/lib/render-attempt-processes";
import { processProjectDeletion } from "../src/lib/project-cleanup";
const lock = path.join(dataDir, "worker.lock");
async function main() {
  const instanceId = randomUUID();
  const cachePolicy = cacheRetentionPolicy();
  const kernelManaged = process.env.REELCHEMY_WORKER_KERNEL_LOCK === "1";
  if (process.env.NODE_ENV === "production" && !kernelManaged)
    throw new Error(
      "Start production rendering with npm run worker so the kernel lifecycle lock is held.",
    );
  if (kernelManaged) {
    try {
      const previous = await readFile(lock, "utf8");
      let managed = false;
      try {
        managed = JSON.parse(previous).kind === "reelchemy-worker-lock-v2";
      } catch {}
      if (!managed) {
        const pid = Number(previous.trim());
        if (!Number.isInteger(pid) || pid < 2)
          throw new Error(
            "Legacy worker lock is malformed. Stop old workers before upgrading.",
          );
        let alive = true;
        try {
          process.kill(pid, 0);
        } catch (e) {
          if ((e as NodeJS.ErrnoException).code === "ESRCH") alive = false;
          else throw e;
        }
        if (alive)
          throw new Error(
            "A legacy worker PID is still running. Stop old workers before adopting the lifecycle entrypoint.",
          );
      }
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    }
    const temporary = path.join(dataDir, `.worker-lock-${randomUUID()}.tmp`);
    try {
      await writeFile(
        temporary,
        JSON.stringify({
          kind: "reelchemy-worker-lock-v2",
          pid: process.pid,
          instanceId,
          startedAt: new Date().toISOString(),
        }),
        { flag: "wx", mode: 0o600 },
      );
      await rename(temporary, lock);
    } finally {
      try {
        await unlink(temporary);
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
      }
    }
  } else {
    try {
      const handle = await open(lock, "wx", 0o600);
      await handle.writeFile(String(process.pid));
      await handle.close();
    } catch {
      throw new Error(
        "Worker lock exists. Run one worker; after a crash verify the old PID is gone before removing the legacy lock.",
      );
    }
  }
  let stopping = false;
  for (const signal of ["SIGTERM", "SIGINT"] as const)
    process.on(signal, () => {
      stopping = true;
    });
  const heartbeat = path.join(dataDir, HEARTBEAT_NAME);
  const heartbeatTemp = `${heartbeat}.${process.pid}.tmp`;
  let heartbeatWriting = false;
  let cacheReady = !kernelManaged;
  let maintenanceDue = true;
  let lastMaintenance = 0;
  async function beat() {
    if (heartbeatWriting) return;
    heartbeatWriting = true;
    try {
      await writeFile(
        heartbeatTemp,
        JSON.stringify({
          at: new Date().toISOString(),
          instanceId,
          ready: cacheReady,
        }),
        { mode: 0o600 },
      );
      await rename(heartbeatTemp, heartbeat);
    } finally {
      heartbeatWriting = false;
    }
  }
  let timer: ReturnType<typeof setInterval> | undefined;
  try {
    if (process.env.NODE_ENV === "production") await preparedRenderer();
    timer = setInterval(() => {
      void beat().catch(() => {});
    }, 5000);
    let reportedInterrupted = false;
    while (!stopping && (await liveNativeRenderJobs(dataDir)).size) {
      cacheReady = false;
      await beat();
      if (!reportedInterrupted) {
        console.error(
          JSON.stringify({
            event: "render.recovery.waiting",
            code: "PREVIOUS_NATIVE_ATTEMPT_ACTIVE",
          }),
        );
        reportedInterrupted = true;
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    if (stopping) return;
    recoverJobs();
    await beat();
    let announced = false;
    while (!stopping) {
      if (await processProjectDeletion(() => stopping)) {
        maintenanceDue = true;
        continue;
      }
      if (kernelManaged) await processExportFileRemoval(() => stopping);
      if (stopping) break;
      if (
        kernelManaged &&
        (maintenanceDue || Date.now() - lastMaintenance >= 60000)
      ) {
        try {
          const report = maintainSceneCache(cachePolicy);
          cacheReady = true;
          maintenanceDue = false;
          lastMaintenance = Date.now();
          await beat();
          if (report.removeEntries)
            console.log(
              JSON.stringify({
                event: "cache.prune.complete",
                entries: report.removeEntries,
                bytes: report.removeBytes,
                retainedEntries: report.retainedEntries,
                retainedBytes: report.retainedBytes,
              }),
            );
        } catch {
          cacheReady = false;
          await beat();
          console.error(
            JSON.stringify({
              event: "cache.prune.blocked",
              code: "SCENE_CACHE_UNAVAILABLE",
            }),
          );
          await new Promise((resolve) => setTimeout(resolve, 5000));
          continue;
        }
      }
      if (!announced) {
        console.log("Reelchemy render worker ready");
        announced = true;
      }
      const claimed = claimJob();
      if (!claimed) {
        await new Promise((r) => setTimeout(r, 500));
        continue;
      }
      maintenanceDue = true;
      const { job, timeline } = claimed;
      console.log(JSON.stringify({ event: "render.start", jobId: job.id }));
      const deadline =
        Date.now() +
        Math.max(
          60000,
          Math.min(900000, Number(process.env.RENDER_JOB_TIMEOUT_MS) || 600000),
        );
      try {
        process.env[renderJobMarker] = job.id;
        process.env[renderRootMarker] = dataDir;
        recordJobStage(job.id, "Starting export");
        const report = await renderFilm(
          timeline,
          path.join(artifactDir, job.id),
          (p) => {
            updateJob(job.id, { progress: p });
          },
          () =>
            stopping ||
            Date.now() > deadline ||
            getJob(job.id)?.status === "cancelled",
          (stage) => recordJobStage(job.id, stage),
          workspaceForProject(job.projectId) || "legacy",
        );
        updateJob(job.id, {
          status: "completed",
          progress: 1,
          report,
          issues: report.qc.after,
          attempts: report.qc.repairAttempts,
        });
        console.log(
          JSON.stringify({
            event: "render.complete",
            jobId: job.id,
            export: report.export,
          }),
        );
      } catch (error) {
        const message =
          Date.now() > deadline
            ? "Export exceeded its total time limit."
            : error instanceof Error
              ? error.message
              : "Render failed";
        if (
          stopping &&
          retryJob(
            job.id,
            "Worker stopped; export will restart from its saved timeline.",
          )
        )
          break;
        if (
          !stopping &&
          Date.now() <= deadline &&
          transientRenderError(error) &&
          retryJob(job.id, message)
        ) {
          console.log(
            JSON.stringify({
              event: "render.retry",
              jobId: job.id,
              error: message,
            }),
          );
          continue;
        }
        recordJobStage(job.id, "Failed", message);
        updateJob(job.id, {
          status: "failed",
          error: message,
          ...(error instanceof RenderQCError ? { issues: error.issues } : {}),
        });
        console.error(
          JSON.stringify({
            event: "render.failed",
            jobId: job.id,
            error: message,
          }),
        );
      } finally {
        delete process.env[renderJobMarker];
        delete process.env[renderRootMarker];
        if ((await liveNativeRenderJobs(dataDir)).has(job.id)) {
          cacheReady = false;
          await beat();
          throw new Error(
            "The previous native export attempt is still active. Rendering and cleanup require operator review.",
          );
        }
        finishJobAttempt(job.id);
      }
    }
  } finally {
    clearInterval(timer);
    while (heartbeatWriting) await new Promise((r) => setTimeout(r, 20));
    for (const file of [heartbeat, heartbeatTemp, lock]) {
      try {
        await unlink(file);
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
      }
    }
  }
}
main().catch((e) => {
  if (e instanceof RenderProcessInspectionError)
    console.error(
      JSON.stringify({
        event: "render.process.inspection.failed",
        pid: e.processId,
        code: e.reason,
      }),
    );
  console.error(e.message);
  process.exitCode = 1;
});
