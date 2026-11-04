import { appendFileSync } from "node:fs";
import { runMailWorker } from "../../src/lib/mail-worker-runtime";
// This explicit fixture never calls an SMTP transport, even in production mode.
await runMailWorker(async () => {
  appendFileSync(process.env.MAIL_TEST_RECEIPT!, "fake-delivery\n", {
    mode: 0o600,
  });
});
