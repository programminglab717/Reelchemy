import { lstatSync } from "node:fs";
import path from "node:path";
export function assertRestoreComplete(dataDirectory: string) {
  try {
    lstatSync(
      path.join(
        path.dirname(path.resolve(dataDirectory)),
        "RESTORE_PENDING.json",
      ),
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  throw new Error(
    "Restore reconciliation is incomplete. Do not start writers in this destination.",
  );
}
