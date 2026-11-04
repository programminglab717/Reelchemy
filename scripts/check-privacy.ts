import { privacyWorkerHealthy } from "../src/lib/privacy-worker-state";
if (!privacyWorkerHealthy()) {
  console.error("Account cleanup consumer is unavailable.");
  process.exitCode = 1;
}
