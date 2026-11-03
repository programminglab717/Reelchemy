import { measureExportFiles } from "./export-storage-files";
import {
  ExportStorageUnavailable,
  ExportOutputLimit,
} from "./export-storage-policy";
import { maximumExportReviewBytes } from "./export-file-policy";
export async function beginExportMeter(
  root: string,
  jobId: string,
  ceilingBytes: number,
) {
  if (
    !Number.isSafeInteger(ceilingBytes) ||
    ceilingBytes < 1024 ** 2 ||
    ceilingBytes > maximumExportReviewBytes
  )
    throw new ExportStorageUnavailable();
  let failure: ExportStorageUnavailable | ExportOutputLimit | undefined,
    latest = await measureExportFiles(root, jobId, { working: true }),
    stopped = false,
    wake: () => void = () => {};
  if (latest.bytes > ceilingBytes) failure = new ExportOutputLimit();
  const running = (async () => {
    while (!stopped && !failure) {
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, 250);
        wake = () => {
          clearTimeout(timer);
          resolve();
        };
      });
      wake = () => {};
      if (stopped) break;
      try {
        latest = await measureExportFiles(root, jobId, { working: true });
        if (latest.bytes > ceilingBytes) failure = new ExportOutputLimit();
      } catch {
        failure = new ExportStorageUnavailable();
      }
    }
  })();
  let closing: Promise<{ bytes: number; files: number }> | undefined;
  return {
    get cancelled() {
      return failure !== undefined;
    },
    get error() {
      return failure;
    },
    assertWithinBudget() {
      if (failure) throw failure;
    },
    // Native producers must have closed before this stable final observation.
    // Return the actual footprint even when the quota was exceeded so it remains
    // charged until reviewed cleanup. An unreadable tree throws instead of zeroing it.
    stop() {
      return (closing ??= (async () => {
        stopped = true;
        wake();
        await running;
        latest = await measureExportFiles(root, jobId);
        if (latest.bytes > ceilingBytes) failure = new ExportOutputLimit();
        return latest;
      })());
    },
  };
}
