import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import {
  isMotionFile,
  motionFiles,
  motionFileType,
  type MotionFile,
} from "./libraries";

// Server-side reader for the allowlisted motion files, resolved from the
// installed packages (the studio and workers both run from the app root).
// Results are cached: installed packages never change while running.
const root = () => path.join(process.cwd(), "node_modules");
const cache = new Map<string, Buffer>();

// three.js ships as ES modules. Scene documents load every library as a
// plain script (modules would need cross-origin fetches from the sandboxed
// scene), so the core and the chosen add-ons are bundled once into a script
// that sets window.THREE: rounded boxes, SVG shapes for extruded logos, a
// studio lighting environment and bloom post-processing.
const threeEntry = `
import * as core from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { SVGLoader } from "three/addons/loaders/SVGLoader.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
window.THREE = Object.assign({}, core, { RoundedBoxGeometry, SVGLoader, RoomEnvironment, EffectComposer, RenderPass, UnrealBloomPass, OutputPass });
`;
function bundleThree() {
  // Loaded at run time from the installed packages (not bundled into the
  // studio's own server code).
  const esbuild = createRequire(path.join(process.cwd(), "package.json"))(
    "esbuild",
  ) as typeof import("esbuild");
  const result = esbuild.buildSync({
    stdin: { contents: threeEntry, resolveDir: process.cwd(), loader: "js" },
    bundle: true,
    format: "iife",
    minify: true,
    legalComments: "none",
    target: "es2020",
    write: false,
    logLevel: "silent",
  });
  return Buffer.from(result.outputFiles[0].contents);
}

export function readMotionFile(name: MotionFile) {
  let bytes = cache.get(name);
  if (!bytes) {
    if (name === "three.js") bytes = bundleThree();
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
