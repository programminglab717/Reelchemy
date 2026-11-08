import { readFileSync } from "node:fs";
import path from "node:path";
import {
  isMotionFile,
  motionFiles,
  motionFileType,
  type MotionFile,
} from "./libraries";
import { THREE_BUNDLE_PATH } from "./three-bundle";

// Server-side reader for the allowlisted motion files, resolved from the
// installed packages (the studio and workers both run from the app root).
// Results are cached: installed packages never change while running.
const root = () => path.join(process.cwd(), "node_modules");
const cache = new Map<string, Buffer>();

export function readMotionFile(name: MotionFile) {
  let bytes = cache.get(name);
  if (!bytes) {
    // three.js is bundled ahead of time into one plain script (see
    // three-bundle.ts); nothing is compiled while serving.
    if (name === "three.js")
      bytes = readFileSync(path.join(process.cwd(), THREE_BUNDLE_PATH));
    else {
      const source = readFileSync(path.join(root(), motionFiles[name]));
      bytes =
        name === "icons.js"
          ? Buffer.from(
              `window.__reelchemyIcons=${JSON.stringify(JSON.parse(source.toString("utf8")))};`,
            )
          : source;
    }
    cache.set(name, bytes);
  }
  return { bytes, type: motionFileType(name) };
}

// The file served to scene documents under `name`, or null when the name is
// not allowlisted.
export function serveMotionFile(name: string) {
  return isMotionFile(name) ? readMotionFile(name) : null;
}
