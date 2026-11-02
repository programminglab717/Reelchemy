import path from "node:path";
export function renderCacheRootDirectory() {
  return path.resolve(
    process.env.REELCHEMY_RENDER_CACHE_DIR || "artifacts/.scene-cache",
  );
}
export function renderCacheWorkspaceDirectory(namespace: string) {
  if (!/^(?:local|legacy|[a-f0-9-]{36})$/.test(namespace))
    throw new Error("Invalid render cache workspace.");
  return path.resolve(renderCacheRootDirectory(), namespace);
}
