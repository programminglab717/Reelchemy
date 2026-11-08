// Developer tool: render the motion reference scenes through the real export
// pipeline, as a check of what code scenes look like as finished video.
//   npx tsx scripts/render-showcase.ts [--resolution=1080p|standard]
//     [--scene=scene.json --seconds=8 --format=landscape] (one scene instead)
import { readFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { renderFilm } from "../src/lib/render";
import { motionCodeSchema, timelineSchema } from "../src/lib/schema";
import { cacheAsideScene } from "../src/motion/examples/cache-aside";
import { postgresIndexScene } from "../src/motion/examples/postgres-index";
import {
  assertNoLegacyRenderWorker,
  renderToolEnvironment,
  runWithRenderLifecycle,
} from "./render-lifecycle";

const args = Object.fromEntries(
  process.argv.slice(2).map((arg) => arg.replace(/^--/, "").split("=")),
);
const resolution = z
  .enum(["standard", "1080p"])
  .parse(args.resolution ?? "1080p");
if (
  process.platform === "linux" &&
  process.env.REELCHEMY_SAMPLE_KERNEL_LOCK !== "1"
) {
  process.exitCode = await runWithRenderLifecycle(
    ["scripts/render-showcase.ts", ...process.argv.slice(2)],
    {
      ...renderToolEnvironment(),
      AI_PROVIDER: "mock",
      REELCHEMY_SAMPLE_KERNEL_LOCK: "1",
    },
    "A render process is active. Stop it before running a showcase export.",
  );
} else {
  if (process.platform === "linux") await assertNoLegacyRenderWorker();
  const scene = (
    id: string,
    title: string,
    seconds: number,
    code: typeof cacheAsideScene,
  ) => ({
    id,
    title,
    intent: title,
    durationFrames: seconds * 30,
    background: "#070b18",
    accent: "#38bdf8",
    strategy: "diagram" as const,
    layers: [],
    transition: "cut" as const,
    code,
  });
  const single = args.scene
    ? motionCodeSchema.parse(JSON.parse(readFileSync(args.scene, "utf8")))
    : undefined;
  const timeline = timelineSchema.parse({
    version: 1,
    fps: 30,
    format: z
      .enum(["landscape", "portrait", "square"])
      .parse(args.format ?? "landscape"),
    exportResolution: resolution === "1080p" ? "1080p" : undefined,
    scenes: single
      ? [scene("scene", "Scene", Number(args.seconds ?? 8), single)]
      : [
          scene("cache-aside", "Cache-aside with Redis", 14, cacheAsideScene),
          scene(
            "postgres-index",
            "How PostgreSQL finds one row",
            15,
            postgresIndexScene,
          ),
        ],
  });
  let stopping = false;
  process.on("SIGTERM", () => (stopping = true));
  const started = Date.now();
  const report = await renderFilm(
    timeline,
    path.resolve(process.env.REELCHEMY_ARTIFACT_DIR || "artifacts", "showcase"),
    undefined,
    () => stopping,
  );
  console.log(
    JSON.stringify({
      seconds: (Date.now() - started) / 1000,
      video: report.export,
    }).slice(0, 2000),
  );
}
