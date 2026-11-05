import { MAX_TIMELINE_SECONDS } from "../src/lib/timeline-limits";
import { renderAttemptPolicy } from "../src/lib/render-attempt-policy";
import path from "node:path";
import { mkdir, readFile, writeFile, realpath } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { storagePathsOverlap } from "../src/lib/auth-storage";

// Experimental synthetic pipeline measurements, never a way to admit longer
// public jobs. Every run exclusively owns a NEW directory outside live storage.
const exec = promisify(execFile);
let output: string | undefined;
let stage = "Validating fixture";
const failureContext: Record<string, unknown> = {};
try {
  const args = new Map<string, string>();
  for (const raw of process.argv.slice(2)) {
    const match = /^--(output|duration|format|resolution|profile)=(.+)$/.exec(
      raw,
    );
    if (!match || args.has(match[1])) throw new Error();
    args.set(match[1], match[2]);
  }
  const duration = z
    .enum(["5", "60", "180", "300"])
    .parse(args.get("duration") || "60");
  const format = z
    .enum(["landscape", "portrait", "square"])
    .parse(args.get("format") || "landscape");
  const exportResolution = z
    .enum(["standard", "1080p"])
    .parse(args.get("resolution") || "1080p");
  const profile = z
    .enum(["static", "motion", "footage", "full-footage"])
    .parse(args.get("profile") || "footage");
  const fullFootage = profile === "full-footage";
  const withFootage = profile === "footage" || fullFootage;
  const supplied = args.get("output");
  if (process.platform !== "linux" || !supplied || !path.isAbsolute(supplied))
    throw new Error();
  const selected = path.join(
    await realpath(path.dirname(supplied)),
    path.basename(supplied),
  );
  const protectedRoots = [
    process.cwd(),
    process.env.REELCHEMY_DATA_DIR || ".data",
    process.env.REELCHEMY_AUTH_DIR || process.env.REELCHEMY_DATA_DIR || ".data",
    process.env.REELCHEMY_ARTIFACT_DIR || "artifacts",
    process.env.REELCHEMY_RENDER_CACHE_DIR,
    process.env.REELCHEMY_PRIVACY_DIR,
  ].filter((value): value is string => !!value);
  if (
    protectedRoots.some((root) =>
      storagePathsOverlap(selected, path.resolve(root)),
    )
  )
    throw new Error();
  await mkdir(selected, { mode: 0o700 });
  output = selected;
  const settings = {
    duration: Number(duration),
    format,
    exportResolution,
    profile,
    experimentalPipelineOnly: true,
    publicSupportedSeconds: MAX_TIMELINE_SECONDS,
    deadlineMs: renderAttemptPolicy("")(Number(duration) * 30),
    outputCeilingBytes: 512 * 1024 ** 2,
  };
  failureContext.settings = settings;
  // Do not forward configured account, provider, mail or user-data locations to
  // fixture tools. Keep only runtime/tool discovery and private run directories.
  const environment: NodeJS.ProcessEnv = { NODE_ENV: "test" };
  for (const key of [
    "PATH",
    "LANG",
    "TMPDIR",
    "CHROMIUM_PATH",
    "RENDER_CONCURRENCY",
  ])
    if (process.env[key] !== undefined) environment[key] = process.env[key];
  for (const key of Object.keys(process.env)) delete process.env[key];
  Object.assign(process.env, environment, {
    NODE_ENV: "test",
    REELCHEMY_DATA_DIR: path.join(output, "data"),
    REELCHEMY_ARTIFACT_DIR: path.join(output, "artifacts"),
    REELCHEMY_RENDER_CACHE_DIR: path.join(output, "cache"),
    REELCHEMY_NEXT_DIST_DIR: path.join(output, "composition-build"),
  });
  const build = process.env.REELCHEMY_NEXT_DIST_DIR!;
  await mkdir(build);
  await writeFile(
    path.join(build, "BUILD_ID"),
    `synthetic-benchmark-${randomUUID()}`,
  );
  stage = "Preparing fixture composition";
  const preparing = performance.now();
  await exec(
    process.execPath,
    ["--import", "tsx", "scripts/check-render-bundle.ts"],
    { timeout: 180000, maxBuffer: 1024 ** 2 },
  );
  const preparationMs = performance.now() - preparing;
  Object.assign(process.env, { NODE_ENV: "production" });
  const { blankTimeline } = await import("../src/lib/editor");
  const { timelineSchema, totalFrames } = await import("../src/lib/schema");
  const { localSceneTimeline } = await import("../src/lib/render-cache");
  const { renderFilm } = await import("../src/lib/render");
  const { beginExportMeter } = await import("../src/lib/export-storage-meter");
  const { runCommand } = await import("../src/lib/process");
  const { storeVideo } = await import("../src/lib/video");
  const sceneSeconds = fullFootage ? 10 : 20;
  const clipSeconds = Math.min(sceneSeconds, settings.duration);
  const source = path.join(output, "synthetic-source.mp4");
  stage = "Generating synthetic footage";
  let asset: Awaited<ReturnType<typeof storeVideo>> | undefined;
  if (withFootage) {
    await runCommand(
      "ffmpeg",
      [
        "-v",
        "error",
        "-f",
        "lavfi",
        "-i",
        `testsrc2=size=${fullFootage ? "1920x1080" : "1280x720"}:rate=30:duration=${clipSeconds}`,
        "-f",
        "lavfi",
        "-i",
        `sine=frequency=440:sample_rate=48000:duration=${clipSeconds}`,
        "-c:v",
        "libx264",
        "-threads",
        "2",
        "-preset",
        "fast",
        "-crf",
        "23",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        source,
      ],
      { timeoutMs: 30000 },
    );
    asset = await storeVideo(
      await readFile(source),
      "Synthetic motion.mp4",
      "Generated private benchmark fixture",
    );
  }
  const base = blankTimeline({
    prompt: "Synthetic pipeline benchmark",
    duration: clipSeconds,
    format,
  });
  const sceneCount = Math.ceil(settings.duration / sceneSeconds);
  const timeline = {
    fps: 30 as const,
    format,
    exportResolution,
    scenes: Array.from({ length: sceneCount }, (_, i) => {
      const scene = structuredClone(base.scenes[0]);
      scene.id = `section-${i + 1}`;
      scene.title = `Synthetic section ${i + 1}`;
      scene.durationFrames = Math.min(
        sceneSeconds * 30,
        settings.duration * 30 - i * sceneSeconds * 30,
      );
      const title = {
        ...scene.layers[0],
        id: "title",
        text: `A clear story / ${i + 1}`,
        y: 0.05,
        height: 0.12,
        fontSize: 40,
      };
      scene.layers = [
        title,
        {
          ...title,
          id: "visual",
          text: "",
          kind: withFootage
            ? ("video" as const)
            : profile === "motion"
              ? ("nodes" as const)
              : ("gradient" as const),
          x: 0.08,
          y: 0.22,
          width: 0.84,
          height: 0.5,
          color: "#d5f281",
          ...(withFootage && asset
            ? {
                assetId: asset.id,
                video: {
                  startFrame: 0,
                  offsetFrames: 0,
                  durationFrames: scene.durationFrames,
                  volume: 0.12,
                  audio: true,
                  fit: "contain" as const,
                },
              }
            : {}),
        },
      ];
      if (fullFootage) {
        const video = { ...scene.layers[1], x: 0, y: 0, width: 1, height: 1 };
        if (video.video) video.video = { ...video.video, fit: "cover" };
        scene.layers = [
          video,
          {
            ...title,
            id: "title-background",
            kind: "rectangle",
            text: "",
            x: 0.04,
            y: 0.04,
            width: 0.92,
            height: 0.14,
            color: "#101D31",
          },
          title,
        ];
      }
      return scene;
    }),
    captions: Array.from(
      { length: fullFootage ? Math.ceil(settings.duration / 3) : sceneCount },
      (_, i) => {
        const span = fullFootage ? 90 : 600;
        const start = i * span,
          end = Math.min(settings.duration * 30, start + span);
        return {
          id: `cue-${i}`,
          text: `Synthetic caption / ${i + 1}`,
          startFrame: start,
          endFrame: end - 1,
        };
      },
    ),
  };
  // Each scene is a valid bounded composition. Aggregate longer timelines are
  // trusted test input; public creation/edit/export admission remains unchanged.
  for (let i = 0; i < timeline.scenes.length; i++)
    timelineSchema.parse(localSceneTimeline(timeline, i));
  const acceptedByPublicSchema = timelineSchema.safeParse(timeline).success;
  if (settings.duration <= MAX_TIMELINE_SECONDS && !acceptedByPublicSchema)
    throw new Error();
  await writeFile(
    path.join(output, "input.json"),
    JSON.stringify(
      {
        settings,
        acceptedByPublicSchema,
        timeline,
        assets: asset ? [asset] : [],
      },
      null,
      2,
    ),
    { mode: 0o600 },
  );
  const resources = async () => ({
    memoryBytes:
      Number(
        await readFile("/sys/fs/cgroup/memory.current", "utf8").catch(
          () => "NaN",
        ),
      ) || null,
    memoryEvents: await readFile("/sys/fs/cgroup/memory.events", "utf8").catch(
      () => null,
    ),
    memoryLimit: await readFile("/sys/fs/cgroup/memory.max", "utf8").catch(
      () => null,
    ),
    cpuLimit: await readFile("/sys/fs/cgroup/cpu.max", "utf8").catch(
      () => null,
    ),
    memoryPeakBytes:
      Number(
        await readFile("/sys/fs/cgroup/memory.peak", "utf8").catch(() => "NaN"),
      ) || null,
    memorySwapBytes: await readFile(
      "/sys/fs/cgroup/memory.swap.current",
      "utf8",
    )
      .then((value) => Number(value))
      .catch(() => null),
    processLimit: await readFile("/sys/fs/cgroup/pids.max", "utf8").catch(
      () => null,
    ),
    memoryCategories: Object.fromEntries(
      (await readFile("/sys/fs/cgroup/memory.stat", "utf8").catch(() => ""))
        .trim()
        .split("\n")
        .map((line) => line.split(" "))
        .filter(([key]) => ["anon", "file", "shmem", "kernel"].includes(key))
        .map(([key, value]) => [key, Number(value)]),
    ),
  });
  const before = await resources();
  failureContext.before = before;
  const jobId = randomUUID(),
    artifacts = process.env.REELCHEMY_ARTIFACT_DIR!;
  const meter = await beginExportMeter(
    artifacts,
    jobId,
    settings.outputCeilingBytes,
  );
  let peakSampledMemoryBytes = before.memoryBytes || 0;
  const sample = setInterval(
    () =>
      void resources().then((value) => {
        peakSampledMemoryBytes = Math.max(
          peakSampledMemoryBytes,
          value.memoryBytes || 0,
        );
      }),
    500,
  );
  let stopping = false;
  const stop = () => {
    stopping = true;
  };
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
  const started = performance.now();
  try {
    await writeFile(
      path.join(output, "run.json"),
      JSON.stringify(
        { settings, before, startedAt: new Date().toISOString() },
        null,
        2,
      ),
      { mode: 0o600 },
    );
    const report = await renderFilm(
      timeline,
      path.join(artifacts, jobId),
      undefined,
      () =>
        stopping ||
        meter.cancelled ||
        performance.now() - started >= settings.deadlineMs,
      (value) => {
        stage = value;
        console.log(
          JSON.stringify({
            stage,
            elapsedMs: Math.round(performance.now() - started),
          }),
        );
      },
      randomUUID(),
    );
    const footprint = await meter.stop();
    meter.assertWithinBudget();
    const result = {
      passed: true,
      settings,
      acceptedByPublicSchema,
      totalFrames: totalFrames(timeline),
      sceneCount: timeline.scenes.length,
      captionCount: timeline.captions.length,
      preparationMs,
      elapsedMs: performance.now() - started,
      export: report.export,
      footprint,
      sceneCache: report.sceneCache,
      qc: report.qc,
      before,
      after: await resources(),
      peakSampledMemoryBytes,
      limitations:
        "Synthetic pipeline measurement in this recorded environment. No public job admission, creator/semantic review, immutable image or hosted load acceptance.",
    };
    await writeFile(
      path.join(output, "benchmark.json"),
      JSON.stringify(result, null, 2),
      { mode: 0o600 },
    );
    console.log(
      JSON.stringify({
        passed: true,
        elapsedMs: result.elapsedMs,
        export: report.export,
        output,
      }),
    );
  } finally {
    clearInterval(sample);
    process.off("SIGTERM", stop);
    process.off("SIGINT", stop);
    failureContext.elapsedMs = performance.now() - started;
    failureContext.after = await resources();
    failureContext.peakSampledMemoryBytes = peakSampledMemoryBytes;
    await meter.stop();
  }
} catch (error) {
  if (output)
    await writeFile(
      path.join(output, "benchmark-failed.json"),
      JSON.stringify(
        {
          passed: false,
          stage,
          ...failureContext,
          reason:
            error instanceof Error
              ? error.message.slice(0, 1024)
              : "Unknown fixture failure",
        },
        null,
        2,
      ),
      { mode: 0o600 },
    ).catch(() => {});
  console.error(
    "Synthetic benchmark unavailable or incomplete. Use --output=/new/absolute/directory outside source/live storage [--duration=5|60|180|300] [--format=landscape|portrait|square] [--resolution=standard|1080p] [--profile=static|motion|footage|full-footage]. Existing outputs are never reused. Review owned fixture evidence; public video limits remain unchanged.",
  );
  process.exitCode = 1;
}
