import { configuredPrivacyVault } from "../src/lib/privacy-storage";
import { openAuthCleanupDatabase } from "../src/lib/auth-cleanup-database";
import { processAccountErasureBatch } from "../src/lib/account-erasure-cleanup";
import {
  startPrivacyWorkerState,
  heartbeatPrivacyWorker,
  stopPrivacyWorkerState,
} from "../src/lib/privacy-worker-state";
async function run() {
  const vault = configuredPrivacyVault(),
    opened = openAuthCleanupDatabase(vault),
    identity = startPrivacyWorkerState();
  let stopping = false,
    ready = false,
    cursor = 0;
  let wake: (() => void) | undefined;
  const stop = () => {
    stopping = true;
    wake?.();
  };
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
  try {
    while (!stopping) {
      let delay = 1000;
      try {
        opened.assertCurrent();
        const batch = processAccountErasureBatch(
          opened.database,
          vault,
          cursor,
        );
        cursor = batch.nextSequence;
        ready = batch.blocked === 0;
        if (batch.completed || batch.scheduled || batch.blocked)
          console.log(
            JSON.stringify({ event: "account.cleanup.batch", ...batch }),
          );
        if (!ready) delay = 30000;
      } catch {
        ready = false;
        delay = 30000;
        console.error("Account cleanup needs operator attention.");
      }
      heartbeatPrivacyWorker(identity, ready);
      if (stopping) break;
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          wake = undefined;
          resolve();
        }, delay);
        wake = () => {
          clearTimeout(timer);
          wake = undefined;
          resolve();
        };
      });
    }
  } finally {
    process.off("SIGTERM", stop);
    process.off("SIGINT", stop);
    try {
      stopPrivacyWorkerState(identity);
    } finally {
      opened.close();
    }
  }
}
run().catch(() => {
  console.error("Account cleanup stopped before readiness.");
  process.exitCode = 1;
});
