import { open, unlink, writeFile, rename } from "node:fs/promises";
import path from "node:path";
import {
  artifactDir,
  dataDir,
  claimJob,
  getJob,
  updateJob,
  recoverJobs,
  retryJob,
  recordJobStage,
  workspaceForProject,
} from "../src/lib/db";
import { HEARTBEAT_NAME } from "../src/lib/worker-heartbeat";
import { RenderQCError } from "../src/lib/layout-qc";
import { transientRenderError } from "../src/lib/retry";
import { renderFilm } from "../src/lib/render";
const lock = path.join(dataDir, "worker.lock");
async function main() {
  try {
    const handle = await open(lock, "wx");
    await handle.writeFile(String(process.pid));
    await handle.close();
  } catch {
    throw new Error(
      "Worker lock exists. Run only one worker; after a crash verify the old PID is gone before removing .data/worker.lock.",
    );
  }
  let stopping = false;
  for (const signal of ["SIGTERM", "SIGINT"] as const)
    process.on(signal, () => {
      stopping = true;
    });
  const heartbeat = path.join(dataDir, HEARTBEAT_NAME);
  const heartbeatTemp = `${heartbeat}.${process.pid}.tmp`;
  let heartbeatWriting = false;
  async function beat() {
    if (heartbeatWriting) return;
    heartbeatWriting = true;
    try {
      await writeFile(
        heartbeatTemp,
        JSON.stringify({ at: new Date().toISOString() }),
        { mode: 0o600 },
      );
      await rename(heartbeatTemp, heartbeat);
    } finally {
      heartbeatWriting = false;
    }
  }
  const timer = setInterval(() => {
    void beat().catch(() => {});
  }, 5000);
  try {
    recoverJobs();
    await beat();
    console.log("Reelchemy render worker ready");
    while (!stopping) {
      const claimed = claimJob();
      if (!claimed) {
        await new Promise((r) => setTimeout(r, 500));
        continue;
      }
      const { job, timeline } = claimed;
      console.log(JSON.stringify({ event: "render.start", jobId: job.id }));
      const deadline =
        Date.now() +
        Math.max(
          60000,
          Math.min(900000, Number(process.env.RENDER_JOB_TIMEOUT_MS) || 600000),
        );
      try {
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
  console.error(e.message);
  process.exitCode = 1;
});
