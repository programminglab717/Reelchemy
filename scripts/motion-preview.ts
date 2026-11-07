// Developer tool: capture stills of a code scene (JSON with html/css/js) and
// write them as a contact sheet, reporting errors and motion measurements.
//   npx tsx scripts/motion-preview.ts scene.json out.png [format] [seconds]
import { readFileSync, writeFileSync } from "node:fs";
import { previewMotionScene, contactSheet } from "../src/motion/preflight";
import { motionCodeSchema } from "../src/lib/schema";

const [file, out, format = "landscape", seconds = "15"] = process.argv.slice(2);
if (!file || !out) {
  console.error(
    "Usage: motion-preview.ts scene.json out.png [format] [seconds]",
  );
  process.exit(64);
}
const code = motionCodeSchema.parse(JSON.parse(readFileSync(file, "utf8")));
const duration = Number(seconds);
const times = Array.from({ length: 9 }, (_, i) => (duration * i) / 8);
const result = await previewMotionScene({
  code,
  format: format as "landscape",
  durationSeconds: duration,
  times,
  width: 640,
});
for (const frame of result.frames)
  console.log(
    `${frame.time.toFixed(2)}s detail=${frame.detail.toFixed(1)} change=${frame.change?.toFixed(2) ?? "-"}`,
  );
for (const error of result.errors) console.log("ERROR", error);
if (result.frames.length) writeFileSync(out, await contactSheet(result.frames));
