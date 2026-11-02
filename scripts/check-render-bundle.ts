import { bundle } from "@remotion/bundler";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { rename, access } from "node:fs/promises";
import {
  RENDERER_DIRECTORY,
  sealPreparedRenderer,
  verifyPreparedRenderer,
} from "../src/lib/prepared-renderer";
const output = path.resolve(process.env.REELCHEMY_NEXT_DIST_DIR || ".next");
await access(path.join(output, "BUILD_ID"));
const target = path.join(output, RENDERER_DIRECTORY);
// Next owns/cleans its build directory. Refuse an existing prepared renderer;
// this command never recursively removes a pre-existing path or user storage.
try {
  await access(target);
  throw new Error(
    "Prepared renderer already exists. Run the full application build.",
  );
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
}
const directory = await mkdtemp(path.join(output, ".renderer-build-"));
try {
  // Next's server build does not compile the independent Remotion entrypoint.
  // Compile it too, so accidental server/native imports fail before deployment.
  await bundle({
    entryPoint: path.resolve("src/video/index.tsx"),
    outDir: directory,
    enableCaching: false,
  });
  await sealPreparedRenderer(directory, output);
  await rename(directory, target);
  await verifyPreparedRenderer(output);
  console.log(
    "Prepared video renderer compiled, verified and retained with the production build.",
  );
} finally {
  await rm(directory, { recursive: true, force: true });
}
