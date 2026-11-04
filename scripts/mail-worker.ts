import { mailConfig } from "../src/lib/mail";
import { runMailWorker } from "../src/lib/mail-worker-runtime";
if (mailConfig() !== "smtp")
  throw new Error("Account mail consumer requires SMTP delivery.");
await runMailWorker();
