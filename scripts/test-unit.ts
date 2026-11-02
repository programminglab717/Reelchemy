import {
  spawnTestProcess,
  signalTestProcess,
  shutdownTestProcesses,
} from "./test-process";
import { mkdtemp, readdir, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { DEFAULT_MEDIA_STORAGE_BYTES } from "../src/lib/media-storage-policy";

// Older media-only tests import ingestion before setting any environment. Give
// every unit run a private fallback root so they cannot write into user storage.
const dir = await mkdtemp(path.join(tmpdir(), "reelchemy-unit-"));
const args = process.argv.slice(2);
if (!args.some((arg) => arg.endsWith(".test.ts")))
  args.push(
    ...(await readdir("tests"))
      .filter((file) => file.endsWith(".test.ts"))
      .sort()
      .map((file) => path.join("tests", file)),
  );
const env: NodeJS.ProcessEnv = {
  ...process.env,
  NODE_ENV: "test",
  EMAIL_DELIVERY: "file",
  AI_PROVIDER: "mock",
  BETTER_AUTH_URL: "http://127.0.0.1:3001",
  REELCHEMY_DATA_DIR: path.join(dir, "data"),
  REELCHEMY_ARTIFACT_DIR: path.join(dir, "artifacts"),
  REELCHEMY_RENDER_CACHE_DIR: path.join(dir, "cache"),
  REELCHEMY_MEDIA_STORAGE_BYTES: String(DEFAULT_MEDIA_STORAGE_BYTES),
  REELCHEMY_PROJECT_DATA_BYTES: "33554432",
  REELCHEMY_STUDIO_DATA_BYTES: "268435456",
  REELCHEMY_SERVICE_DATA_BYTES: "4294967296",
  REELCHEMY_STUDIO_PROJECTS: "500",
  REELCHEMY_SERVICE_PROJECTS: "20000",
  REELCHEMY_PROJECT_VERSIONS: "10000",
  REELCHEMY_PROJECT_MESSAGES: "10000",
  REELCHEMY_WRITES_PER_MINUTE: "120",
  REELCHEMY_MEDIA_REQUESTS_PER_HOUR: "30",
  REELCHEMY_PLANS_PER_DAY: "60",
  REELCHEMY_EXPORT_REQUESTS_PER_DAY: "30",
  REELCHEMY_ACTIVE_EXPORTS_PER_STUDIO: "2",
  REELCHEMY_MEDIA_INPUT_SLOTS: "4",
  REELCHEMY_MEDIA_INPUTS_PER_STUDIO: "1",
  REELCHEMY_MEDIA_ANALYSIS_SLOTS: "16",
  REELCHEMY_MEDIA_ANALYSES_PER_STUDIO: "4",
  REELCHEMY_MEDIA_RAW_BYTES: "268435456",
  REELCHEMY_WAVEFORMS_PER_HOUR: "120",
};
for (const key of [
  "BETTER_AUTH_SECRET",
  "AI_API_KEY",
  "AI_BASE_URL",
  "AI_MODEL",
  "SMTP_HOST",
  "SMTP_USER",
  "SMTP_PASSWORD",
  "EMAIL_FROM",
  "REELCHEMY_AUTH_DIR",
])
  delete env[key];
for (const key of Object.keys(env))
  if (key.startsWith("REELCHEMY_AI_")) delete env[key];
async function run(arguments_: string[]) {
  const child = spawnTestProcess(process.execPath, arguments_, {
    env,
    stdio: "inherit",
  });
  const stop = (signal: NodeJS.Signals) => signalTestProcess(child, signal);
  const term = () => stop("SIGTERM"),
    interrupt = () => stop("SIGINT");
  process.on("SIGTERM", term);
  process.on("SIGINT", interrupt);
  try {
    return await new Promise<number>((resolve, reject) => {
      child.once("error", reject);
      child.once("close", (code) => resolve(code ?? 1));
    });
  } finally {
    process.off("SIGTERM", term);
    process.off("SIGINT", interrupt);
    await shutdownTestProcesses([child]);
  }
}
try {
  if (
    args.some((arg) =>
      [
        "cache-cli.test.ts",
        "cache-worker.test.ts",
        "project-deletions.test.ts",
        "render-static.test.ts",
      ].includes(path.basename(arg)),
    )
  ) {
    // Compile the actual composition once. Native workers exercise the same
    // prepared production path without racing independent cold compilers.
    const build = path.join(dir, "build");
    await mkdir(build);
    await writeFile(
      path.join(build, "BUILD_ID"),
      "private-native-unit-fixture",
    );
    env.REELCHEMY_NEXT_DIST_DIR = build;
    if (
      (await run(["--import", "tsx", "scripts/check-render-bundle.ts"])) !== 0
    )
      throw new Error("Preparing the isolated native-test renderer failed.");
  }
  process.exitCode = await run([
    "--import",
    "tsx",
    "--test",
    "--test-concurrency=2",
    "--test-timeout=120000",
    ...args,
  ]);
} finally {
  await rm(dir, { recursive: true, force: true });
}
