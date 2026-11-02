import path from "node:path";
import { z } from "zod";
import { mockPlan } from "../src/lib/provider";
import { renderFilm } from "../src/lib/render";
import { maintainSceneCache } from "../src/lib/cache-retention";
import {
  assertNoLegacyRenderWorker,
  renderToolEnvironment,
  runWithRenderLifecycle,
} from "./render-lifecycle";
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
if (
  process.platform === "linux" &&
  process.env.REELCHEMY_SAMPLE_KERNEL_LOCK !== "1"
) {
  process.exitCode = await runWithRenderLifecycle(
    ["scripts/render-sample.ts", ...process.argv.slice(2)],
    {
      ...renderToolEnvironment(),
      AI_PROVIDER: "mock",
      REELCHEMY_SAMPLE_KERNEL_LOCK: "1",
    },
    "A render process is active. Stop it before running a sample export.",
  );
} else {
  if (process.platform !== "linux" && process.env.NODE_ENV === "production")
    throw new Error("Production rendering requires Linux.");
  if (process.platform === "linux") {
    await assertNoLegacyRenderWorker();
    maintainSceneCache();
  }
  let stopping = false;
  const stop = () => {
    stopping = true;
  };
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
  try {
    const report = await renderFilm(
      mockPlan({ prompt: "Ideas become motion.", duration, format }),
      path.resolve(process.env.REELCHEMY_ARTIFACT_DIR || "artifacts", folder),
      undefined,
      () => stopping,
    );
    console.log(JSON.stringify(report, null, 2));
  } finally {
    process.off("SIGTERM", stop);
    process.off("SIGINT", stop);
    if (process.platform === "linux") maintainSceneCache();
  }
}
