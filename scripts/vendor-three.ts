import { writeFileSync } from "node:fs";
import path from "node:path";
import {
  buildThreeBundle,
  THREE_BUNDLE_PATH,
} from "../src/motion/three-bundle";

// Regenerates the committed three.js bundle served to 3D code scenes. Run
// after changing the three.js version or the add-ons in three-bundle.ts.
const bytes = buildThreeBundle();
writeFileSync(path.resolve(THREE_BUNDLE_PATH), bytes);
console.log(`Wrote ${THREE_BUNDLE_PATH} (${bytes.length} bytes).`);
