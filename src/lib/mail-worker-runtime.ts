import { flushOutbox, type Mail } from "./mail";
import {
  startMailWorkerState,
  heartbeatMailWorker,
  stopMailWorkerState,
} from "./mail-worker-state";
// Explicit local test fixtures inject a fake sender. The real consumer calls
// without an argument and retains SMTP's fixed absolute transport deadline.
export async function runMailWorker(send?: (mail: Mail) => Promise<void>) {
  if (
    process.platform !== "linux" ||
    process.env.REELCHEMY_MAIL_KERNEL_LOCK !== "1"
  )
    throw new Error("Use the account mail kernel-lock entrypoint.");
  const identity = startMailWorkerState();
  let stopping = false,
    ready = false,
    heartbeatError = false;
  let wake: (() => void) | undefined;
  const stop = () => {
    stopping = true;
    wake?.();
  };
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
  const heartbeat = () => {
    try {
      heartbeatMailWorker(identity, ready);
    } catch {
      heartbeatError = true;
      stopping = true;
      wake?.();
    }
  };
  const timer = setInterval(heartbeat, 5000);
  try {
    console.log("Account mail worker started");
    while (!stopping) {
      let delay = 1000;
      try {
        const result = await flushOutbox(send, { shouldStop: () => stopping });
        ready = true;
        if (result.sent || result.failed)
          console.log(JSON.stringify({ event: "mail.batch", ...result }));
      } catch {
        ready = false;
        delay = 30000;
        console.error("Account mail needs operator review.");
      }
      heartbeat();
      if (stopping) break;
      await new Promise<void>((resolve) => {
        const pause = setTimeout(() => {
          wake = undefined;
          resolve();
        }, delay);
        wake = () => {
          clearTimeout(pause);
          wake = undefined;
          resolve();
        };
      });
    }
    if (heartbeatError) throw new Error("Account mail heartbeat unavailable.");
  } finally {
    clearInterval(timer);
    try {
      stopMailWorkerState(identity);
    } finally {
      process.off("SIGTERM", stop);
      process.off("SIGINT", stop);
    }
  }
}
