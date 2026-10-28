import path from "node:path";
import { z } from "zod";
import { mockPlan } from "../src/lib/provider";
import { renderFilm } from "../src/lib/render";
const args = Object.fromEntries(
  process.argv.slice(2).map((arg) => arg.replace(/^--/, "").split("=")),
);
const duration = z.coerce
  .number()
  .int()
  .min(5)
  .max(60)
  .parse(args.duration ?? 5);
const format = z
  .enum(["landscape", "portrait", "square"])
  .parse(args.format ?? "landscape");
const folder =
  duration === 5 && format === "landscape"
    ? "sample"
    : `sample-${format}-${duration}`;
const report = await renderFilm(
  mockPlan({ prompt: "Ideas become motion.", duration, format }),
  path.resolve("artifacts", folder),
);
console.log(JSON.stringify(report, null, 2));
