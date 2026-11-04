import { mailKernelEntrypoint } from "../../scripts/mail-kernel-entrypoint";
import path from "node:path";
mailKernelEntrypoint(
  path.join(process.env.REELCHEMY_AUTH_DIR!, "mail"),
  "tests/helpers/mail-fake-consumer.ts",
);
