import path from "node:path";
import { authStorageDirectory } from "../src/lib/auth-storage";
import { configuredPrivacyVault } from "../src/lib/privacy-storage";
import { openAuthCleanupDatabase } from "../src/lib/auth-cleanup-database";
import { privateKernelEntrypoint } from "./mail-kernel-entrypoint";
try {
  const opened = openAuthCleanupDatabase(configuredPrivacyVault());
  opened.close();
  privateKernelEntrypoint(
    path.join(authStorageDirectory(), "privacy-worker"),
    "scripts/privacy-worker.ts",
    "privacy",
  );
} catch {
  console.error(
    "Account cleanup requires the current initialized privacy authority and migrated private accounts.",
  );
  process.exitCode = 1;
}
