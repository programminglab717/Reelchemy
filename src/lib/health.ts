import { access, readFile, statfs } from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { dataDir, artifactDir, databaseHealthy } from "./db";
import { getAuth } from "./auth";
import { HEARTBEAT_NAME, recentHeartbeat } from "./worker-heartbeat";
import { limitsPolicy } from "./limits-policy";
import { mediaStorageLimit } from "./media-storage-policy";
export async function readiness() {
  const checks = {
    database: false,
    authentication: false,
    storage: false,
    worker: false,
    limits: false,
  };
  try {
    limitsPolicy();
    mediaStorageLimit();
    checks.limits = true;
  } catch {}
  try {
    checks.database = databaseHealthy();
  } catch {}
  try {
    await getAuth();
    checks.authentication = true;
  } catch {}
  try {
    const requested = Number(process.env.REELCHEMY_MIN_FREE_BYTES);
    const minimum =
      Number.isFinite(requested) && requested > 0
        ? Math.max(50 * 1024 * 1024, Math.min(10 * 1024 ** 3, requested))
        : 200 * 1024 * 1024;
    const disks = await Promise.all(
      [dataDir, artifactDir].map(async (dir) => {
        await access(dir, constants.W_OK);
        const stats = await statfs(dir);
        return stats.bavail * stats.bsize >= minimum;
      }),
    );
    checks.storage = disks.every(Boolean);
  } catch {}
  try {
    checks.worker = recentHeartbeat(
      JSON.parse(await readFile(path.join(dataDir, HEARTBEAT_NAME), "utf8")),
    );
  } catch {}
  return {
    status: Object.values(checks).every(Boolean)
      ? ("ready" as const)
      : ("not-ready" as const),
    checks,
  };
}
