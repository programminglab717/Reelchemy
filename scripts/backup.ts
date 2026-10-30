import path from "node:path";
import { createBackup, verifyBackup, restoreBackup } from "../src/lib/backup";
const [operation, ...args] = process.argv.slice(2);
try {
  if (operation === "create" && args.length === 1)
    console.log(
      JSON.stringify(
        await createBackup({
          data: path.resolve(process.env.REELCHEMY_DATA_DIR || ".data"),
          auth: path.resolve(
            process.env.REELCHEMY_AUTH_DIR ||
              process.env.REELCHEMY_DATA_DIR ||
              ".data",
          ),
          artifacts: path.resolve(
            process.env.REELCHEMY_ARTIFACT_DIR || "artifacts",
          ),
          output: args[0],
        }),
      ),
    );
  else if (operation === "verify" && args.length === 1) {
    const manifest = await verifyBackup(args[0]);
    console.log(
      JSON.stringify({
        verified: true,
        files: manifest.entries.length,
        createdAt: manifest.createdAt,
      }),
    );
  } else if (operation === "restore" && args.length === 2)
    console.log(JSON.stringify(await restoreBackup(args[0], args[1])));
  else
    throw new Error(
      "Usage: npm run backup -- create <new-backup-directory> | verify <backup-directory> | restore <backup-directory> <new-restore-directory>",
    );
} catch (e) {
  console.error(e instanceof Error ? e.message : "Backup operation failed.");
  process.exitCode = 1;
}
