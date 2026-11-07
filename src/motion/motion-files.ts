import { readFileSync } from "node:fs";
import path from "node:path";
import { motionFiles, motionFileType, type MotionFile } from "./libraries";

// Server-side reader for the allowlisted motion files, resolved from the
// installed packages (the studio and workers both run from the app root).
// Results are cached: installed packages never change while running.
const cache = new Map<MotionFile, Buffer>();
export function readMotionFile(name: MotionFile) {
  let bytes = cache.get(name);
  if (!bytes) {
    const source = readFileSync(
      path.join(process.cwd(), "node_modules", motionFiles[name]),
    );
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
