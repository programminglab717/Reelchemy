import { bundle } from "@remotion/bundler";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
const directory = await mkdtemp(path.join(tmpdir(), "reelchemy-bundle-check-"));
try {
  // Next's server build does not compile the independent Remotion entrypoint.
  // Compile it too, so accidental server/native imports fail before deployment.
  await bundle({
    entryPoint: path.resolve("src/video/index.tsx"),
    outDir: directory,
  });
  console.log("Remotion browser composition bundle compiled successfully.");
} finally {
  await rm(directory, { recursive: true, force: true });
}
