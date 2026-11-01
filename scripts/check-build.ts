import { readFile } from "node:fs/promises";
import path from "node:path";
const directory = process.env.REELCHEMY_NEXT_DIST_DIR || ".next";
const manifest = JSON.parse(
  await readFile(path.join(directory, "prerender-manifest.json"), "utf8"),
) as { routes: Record<string, unknown> };
for (const page of [
  "/",
  "/trash",
  "/api/projects",
  "/api/workspace/storage",
  "/api/workspace/exports",
  "/api/workspace/deletions",
])
  if (manifest.routes[page])
    throw new Error(
      `Authenticated page ${page} was prerendered. Read request headers before authentication initialization.`,
    );
console.log(
  "Authenticated studio pages and private APIs remain dynamic in the production build.",
);
