import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import {
  isMotionFile,
  motionFiles,
  motionFileType,
  threeEntries,
  type MotionFile,
} from "./libraries";

// Server-side reader for the allowlisted motion files, resolved from the
// installed packages (the studio and workers both run from the app root).
// Results are cached: installed packages never change while running.
const root = () => path.join(process.cwd(), "node_modules");
const cache = new Map<string, Buffer>();
export function readMotionFile(name: MotionFile) {
  let bytes = cache.get(name);
  if (!bytes) {
    const source = readFileSync(path.join(root(), motionFiles[name]));
    bytes =
      name === "icons.js"
        ? Buffer.from(
            `window.__reelchemyIcons=${JSON.stringify(JSON.parse(source.toString("utf8")))};`,
          )
        : source;
    cache.set(name, bytes);
  }
  return { bytes, type: motionFileType(name) };
}

// three.js ships as ES modules. Scene documents import it through an import
// map, so the served files are exactly three's core modules plus the chosen
// add-ons and the files they import, found by reading their import lines.
let threeClosure: Set<string> | undefined;
const importPattern =
  /(?:^|[;\s])(?:import|export)\s+(?:[^'"]*?\sfrom\s*)?['"]([^'"]+)['"]/g;
export function threeModuleFiles() {
  if (threeClosure) return threeClosure;
  const files = new Set<string>();
  const queue: string[] = [...threeEntries];
  while (queue.length) {
    const file = queue.shift()!;
    if (files.has(file)) continue;
    const full = path.join(root(), file);
    if (!existsSync(full)) continue;
    files.add(file);
    const source = readFileSync(full, "utf8");
    for (const match of source.matchAll(importPattern)) {
      const specifier = match[1];
      if (specifier === "three") queue.push("three/build/three.module.js");
      else if (specifier.startsWith("three/addons/"))
        queue.push(
          `three/examples/jsm/${specifier.slice("three/addons/".length)}`,
        );
      else if (specifier.startsWith("."))
        queue.push(
          path.posix.normalize(
            path.posix.join(path.posix.dirname(file), specifier),
          ),
        );
    }
  }
  return (threeClosure = files);
}

// The file served to scene documents under `name`, or null when the name is
// not allowlisted.
export function serveMotionFile(name: string) {
  if (isMotionFile(name)) return readMotionFile(name);
  if (!name.startsWith("three/") || !threeModuleFiles().has(name)) return null;
  let bytes = cache.get(name);
  if (!bytes) {
    bytes = readFileSync(path.join(root(), name));
    cache.set(name, bytes);
  }
  return { bytes, type: "text/javascript; charset=utf-8" };
}
