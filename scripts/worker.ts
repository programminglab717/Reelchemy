import { open, unlink } from "node:fs/promises";
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
} from "../src/lib/db";
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
  recoverJobs();
  console.log("Reelchemy render worker ready");
  try {
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
    await unlink(lock);
  }
}
main().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
