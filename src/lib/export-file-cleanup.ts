import {
  artifactDir,
  claimExportFiles,
  finishExportFiles,
  failExportFiles,
} from "./db";
import { removeReviewedExportFiles } from "./export-file-tree";
export async function processExportFileRemoval(isStopping: () => boolean) {
  const task = claimExportFiles();
  if (!task) return false;
  try {
    await removeReviewedExportFiles(artifactDir, task.manifest, isStopping);
    finishExportFiles(task);
    console.log(
      JSON.stringify({ event: "export.files.removed", jobId: task.jobId }),
    );
  } catch {
    failExportFiles(task);
    console.error(
      JSON.stringify({
        event: "export.files.blocked",
        jobId: task.jobId,
        code: "EXPORT_FILE_CLEANUP_UNAVAILABLE",
      }),
    );
  }
  return true;
}
