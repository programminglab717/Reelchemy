import { mailConfig, mailDir } from "../src/lib/mail";
import { mailKernelEntrypoint } from "./mail-kernel-entrypoint";
if (mailConfig() !== "smtp")
  throw new Error(
    "Mail worker requires SMTP delivery; development messages stay in the private mailbox.",
  );
mailKernelEntrypoint(mailDir(), "scripts/mail-worker.ts");
