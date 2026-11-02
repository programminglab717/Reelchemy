import {
  cacheRetentionPolicy,
  CacheRetentionUnavailable,
} from "../src/lib/cache-retention-policy";
import { planSceneCacheRetention } from "../src/lib/cache-retention";
import {
  renderToolEnvironment,
  runWithRenderLifecycle,
} from "./render-lifecycle";
const args = process.argv.slice(2);
try {
  if (args.some((arg) => arg !== "--apply") || args.length > 1)
    throw new Error("Invalid cache maintenance arguments");
  const policy = cacheRetentionPolicy();
  if (!args.includes("--apply")) {
    const plan = planSceneCacheRetention(policy);
    console.log(
      JSON.stringify({ dryRun: true, policy, cache: plan.report }, null, 2),
    );
  } else {
    process.exitCode = await runWithRenderLifecycle(
      ["scripts/cache-maintenance-apply.ts"],
      { ...renderToolEnvironment(), REELCHEMY_CACHE_MAINTENANCE_LOCK: "1" },
      "A render process is active. Stop it before applying scene-cache maintenance.",
    );
  }
} catch (error) {
  console.error(
    error instanceof CacheRetentionUnavailable
      ? error.message
      : "Scene-cache maintenance could not run. Use npm run cache:prune, optionally with -- --apply, and check the dedicated directory configuration.",
  );
  process.exitCode = 1;
}
