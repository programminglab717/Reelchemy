import { mailWorkerHealthy } from "../src/lib/mail-worker-state";
if (!mailWorkerHealthy()) {
  console.error("Account mail consumer is unavailable.");
  process.exitCode = 1;
}
