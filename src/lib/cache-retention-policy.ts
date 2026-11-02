export class CacheRetentionUnavailable extends Error {
  readonly code = "SCENE_CACHE_UNAVAILABLE";
  constructor() {
    super(
      "The rebuildable scene cache needs attention before another export can start.",
    );
  }
}
export type CacheRetentionPolicy = {
  totalBytes: number;
  workspaceBytes: number;
  entries: number;
  maxAgeMs: number;
};
function integer(
  env: Readonly<Record<string, string | undefined>>,
  name: string,
  fallback: number,
  minimum: number,
  maximum: number,
) {
  const value = env[name];
  if (value === undefined) return fallback;
  if (
    !/^\d+$/.test(value) ||
    !Number.isSafeInteger(Number(value)) ||
    Number(value) < minimum ||
    Number(value) > maximum
  )
    throw new CacheRetentionUnavailable();
  return Number(value);
}
export function cacheRetentionPolicy(
  env: Readonly<Record<string, string | undefined>> = process.env,
): CacheRetentionPolicy {
  const policy = {
    totalBytes: integer(
      env,
      "REELCHEMY_SCENE_CACHE_BYTES",
      1024 ** 3,
      1024 ** 2,
      64 * 1024 ** 3,
    ),
    workspaceBytes: integer(
      env,
      "REELCHEMY_SCENE_CACHE_BYTES_PER_STUDIO",
      256 * 1024 ** 2,
      1024 ** 2,
      16 * 1024 ** 3,
    ),
    entries: integer(env, "REELCHEMY_SCENE_CACHE_ENTRIES", 5000, 1, 20000),
    maxAgeMs: integer(env, "REELCHEMY_SCENE_CACHE_DAYS", 7, 1, 90) * 86400000,
  };
  if (policy.workspaceBytes > policy.totalBytes)
    throw new CacheRetentionUnavailable();
  return policy;
}
