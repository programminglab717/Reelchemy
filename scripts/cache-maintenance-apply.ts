import { maintainSceneCache } from "../src/lib/cache-retention";
import { CacheRetentionUnavailable } from "../src/lib/cache-retention-policy";
import { assertNoLegacyRenderWorker } from "./render-lifecycle";
try {
  if (process.env.REELCHEMY_CACHE_MAINTENANCE_LOCK !== "1")
    throw new CacheRetentionUnavailable();
  await assertNoLegacyRenderWorker();
  console.log(
    JSON.stringify({ dryRun: false, cache: maintainSceneCache() }, null, 2),
  );
} catch {
  console.error(
    "Scene-cache maintenance refused unsafe state. Stop legacy render workers and check the dedicated cache directory; original uploads and exports were not targeted.",
  );
  process.exitCode = 1;
}
