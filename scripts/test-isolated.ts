import type { ChildProcess } from "node:child_process";
import {
  spawnTestProcess,
  signalTestProcess,
  shutdownTestProcesses,
} from "./test-process";
import {
  mkdtemp,
  open,
  mkdir,
  cp,
  rm,
  access,
  readFile,
} from "node:fs/promises";
import path from "node:path";
import { constants } from "node:fs";
import { randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import { testTls } from "./test-tls";
import { DEFAULT_MEDIA_STORAGE_BYTES } from "../src/lib/media-storage-policy";
import { initializePrivacyVault } from "../src/lib/privacy-vault";
import { recentHeartbeat } from "../src/lib/worker-heartbeat";
const production = process.argv.includes("--production");
if (production && process.env.NODE_TLS_REJECT_UNAUTHORIZED === "0")
  throw new Error(
    "TLS verification must remain enabled for production checks.",
  );
const args = process.argv.slice(2).filter((value) => value !== "--production");
if (production && process.env.REELCHEMY_CONTAINER_TESTS !== "1")
  throw new Error(
    "Use the disposable Docker test target for production HTTPS checks; its local CA must not enter the host trust store.",
  );
const dir = await mkdtemp(path.join(tmpdir(), "reelchemy-e2e-")),
  port = Number(process.env.E2E_PORT) || 3002,
  app = path.join(dir, "app");
await mkdir(app);
// Mirror source/dependencies/generated routes. No .env files or user state enter tests.
for (const file of [
  "src",
  "scripts",
  "tests",
  "public",
  "package.json",
  "package-lock.json",
  "next.config.ts",
  "tsconfig.json",
  "playwright.config.ts",
])
  await cp(path.resolve(file), path.join(app, file), {
    recursive: true,
    mode: constants.COPYFILE_FICLONE,
  });
const dependencies = path.resolve("node_modules");
await cp(dependencies, path.join(app, "node_modules"), {
  recursive: true,
  mode: constants.COPYFILE_FICLONE,
  // Compiler caches are generated per source/build and can exceed the runtime
  // dependencies. A fixture must not inherit/copy every prior renderer build.
  filter: (source) =>
    path.relative(dependencies, source).split(path.sep)[0] !== ".cache",
});
if (production) {
  await access(".next/BUILD_ID");
  await cp(path.resolve(".next"), path.join(app, ".next"), {
    recursive: true,
    mode: constants.COPYFILE_FICLONE,
  });
}
const log = await open(path.join(dir, "services.log"), "a");
let tls: Awaited<ReturnType<typeof testTls>> | undefined;
const services: ChildProcess[] = [];
let tests: ChildProcess | undefined,
  interrupted = false;
const interrupt = () => {
  interrupted = true;
  if (tests) signalTestProcess(tests, "SIGINT");
  for (const service of services) signalTestProcess(service, "SIGTERM");
};
process.on("SIGTERM", interrupt);
process.on("SIGINT", interrupt);
let result = 1;
try {
  if (production) tls = await testTls(port, dir);
  const baseURL = tls?.origin || `http://127.0.0.1:${port}`;
  const vault = initializePrivacyVault(path.join(dir, "privacy"));
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    NODE_ENV: production ? "production" : "development",
    BETTER_AUTH_URL: baseURL,
    BETTER_AUTH_SECRET: randomBytes(48).toString("base64url"),
    AI_PROVIDER: "mock",
    EMAIL_DELIVERY: production ? "smtp" : "file",
    // Production still queues test mail privately. No SMTP worker is started.
    ...(production
      ? {
          SMTP_HOST: "127.0.0.1",
          EMAIL_FROM: "Reelchemy test <studio@example.test>",
          NODE_EXTRA_CA_CERTS: tls!.caFile,
        }
      : {}),
    REELCHEMY_WRITES_PER_MINUTE: "120",
    REELCHEMY_MAIL_PENDING_COUNT: "1000",
    REELCHEMY_MAIL_PENDING_BYTES: "16777216",
    REELCHEMY_MEDIA_REQUESTS_PER_HOUR: "30",
    REELCHEMY_PLANS_PER_DAY: "60",
    REELCHEMY_EXPORT_REQUESTS_PER_DAY: "30",
    REELCHEMY_ACTIVE_EXPORTS_PER_STUDIO: "2",
    REELCHEMY_EXPORT_RESERVATION_BYTES: "536870912",
    REELCHEMY_EXPORT_STUDIO_BYTES: "2147483648",
    REELCHEMY_EXPORT_SERVICE_BYTES: "8589934592",
    REELCHEMY_EXPORT_STUDIO_COUNT: "100",
    REELCHEMY_EXPORT_SERVICE_COUNT: "2000",
    REELCHEMY_JOB_STUDIO_BYTES: "268435456",
    REELCHEMY_JOB_SERVICE_BYTES: "4294967296",
    REELCHEMY_JOB_STUDIO_COUNT: "500",
    REELCHEMY_JOB_SERVICE_COUNT: "20000",
    REELCHEMY_JOB_STUDIO_RETIRED: "5000",
    REELCHEMY_JOB_SERVICE_RETIRED: "80000",
    REELCHEMY_MEDIA_STORAGE_BYTES: String(DEFAULT_MEDIA_STORAGE_BYTES),
    REELCHEMY_MEDIA_SHARED_STORAGE_BYTES: "8589934592",
    REELCHEMY_PROJECT_DATA_BYTES: "33554432",
    REELCHEMY_STUDIO_DATA_BYTES: "268435456",
    REELCHEMY_SERVICE_DATA_BYTES: "4294967296",
    REELCHEMY_STUDIO_PROJECTS: "500",
    REELCHEMY_SERVICE_PROJECTS: "20000",
    REELCHEMY_PROJECT_VERSIONS: "10000",
    REELCHEMY_PROJECT_MESSAGES: "10000",
    REELCHEMY_DATA_DIR: path.join(dir, "data"),
    REELCHEMY_AUTH_DIR: path.join(dir, "auth"),
    REELCHEMY_PRIVACY_DIR: vault.directory,
    REELCHEMY_PRIVACY_ID: vault.id,
    REELCHEMY_PRIVACY_KEY_FINGERPRINT: vault.keyFingerprint,
    REELCHEMY_ERASURE_PENDING_COUNT: "100",
    REELCHEMY_ERASURE_JOURNAL_COUNT: "1000000",
    REELCHEMY_ARTIFACT_DIR: path.join(dir, "artifacts"),
    REELCHEMY_RENDER_CACHE_DIR: path.join(dir, "cache"),
    REELCHEMY_NEXT_DIST_DIR: ".next",
    RAYON_NUM_THREADS: "2",
    PLAYWRIGHT_BASE_URL: baseURL,
  };
  delete env.AI_API_KEY;
  delete env.SMTP_PASSWORD;
  await mkdir(env.REELCHEMY_ARTIFACT_DIR!, { recursive: true, mode: 0o700 });
  const start = (arguments_: string[], serviceEnv = env) => {
    const child = spawnTestProcess(process.execPath, arguments_, {
      env: serviceEnv,
      cwd: app,
      stdio: ["ignore", log.fd, log.fd],
    });
    services.push(child);
    return child;
  };
  if (production) {
    const migration = start(["--import", "tsx", "scripts/migrate.ts"]);
    const code = await new Promise<number | null>((resolve, reject) => {
      migration.once("error", reject);
      migration.once("close", resolve);
    });
    services.splice(services.indexOf(migration), 1);
    if (code !== 0)
      throw new Error("Production authentication migration failed.");
  }
  const server = start([
    "node_modules/next/dist/bin/next",
    production ? "start" : "dev",
    "--hostname",
    "127.0.0.1",
    "--port",
    String(port),
  ]);
  const renderEnv = { ...env };
  for (const key of Object.keys(renderEnv))
    if (
      key.startsWith("BETTER_AUTH_") ||
      key.startsWith("SMTP_") ||
      key.startsWith("AI_") ||
      key.startsWith("EMAIL_") ||
      key.startsWith("REELCHEMY_PRIVACY_") ||
      key === "REELCHEMY_AUTH_DIR"
    )
      delete renderEnv[key];
  const worker = start(
    ["--import", "tsx", "scripts/worker-entrypoint.ts"],
    renderEnv,
  );
  const ingestEnv: NodeJS.ProcessEnv = {
    NODE_ENV: env.NODE_ENV,
    ...Object.fromEntries(
      Object.entries(env).filter(
        ([key]) =>
          [
            "NODE_ENV",
            "PATH",
            "LANG",
            "LC_ALL",
            "TZ",
            "RAYON_NUM_THREADS",
            "REELCHEMY_DATA_DIR",
            "REELCHEMY_PROJECT_DATA_BYTES",
            "REELCHEMY_STUDIO_DATA_BYTES",
            "REELCHEMY_SERVICE_DATA_BYTES",
            "REELCHEMY_STUDIO_PROJECTS",
            "REELCHEMY_SERVICE_PROJECTS",
            "REELCHEMY_PROJECT_VERSIONS",
            "REELCHEMY_PROJECT_MESSAGES",
          ].includes(key) || key.startsWith("REELCHEMY_MEDIA_"),
      ),
    ),
  };
  const ingestion = start(
    ["--import", "tsx", "scripts/ingest-entrypoint.ts"],
    ingestEnv,
  );
  const deadline = Date.now() + 60000;
  let ready = false;
  const status = async (pathname: string) =>
    tls
      ? tls.status(pathname)
      : (
          await fetch(`${baseURL}${pathname}`, {
            signal: AbortSignal.timeout(5000),
          })
        ).status;
  while (Date.now() < deadline) {
    if (interrupted) throw new Error("Isolated tests interrupted.");
    if (
      server.exitCode !== null ||
      worker.exitCode !== null ||
      ingestion.exitCode !== null
    )
      throw new Error("Test services exited before readiness.");
    try {
      if (
        (await status("/api/projects")) === 401 &&
        (await status("/api/health")) === 200
      ) {
        ready = true;
        break;
      }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  if (!ready) throw new Error("Test services did not become ready.");
  // Development creates the auth schema during first web readiness. Start the
  // private consumer only after that migration, using its credential-free child.
  const privacy = start(["--import", "tsx", "scripts/privacy-entrypoint.ts"]);
  const privacyDeadline = Date.now() + 20000;
  let privacyReady = false;
  while (Date.now() < privacyDeadline) {
    if (interrupted || privacy.exitCode !== null)
      throw new Error("Private cleanup exited before readiness.");
    try {
      const heartbeat = JSON.parse(
        await readFile(
          path.join(
            env.REELCHEMY_AUTH_DIR!,
            "privacy-worker",
            "heartbeat.json",
          ),
          "utf8",
        ),
      );
      if (
        heartbeat.kind === "reelchemy-privacy-worker-v1" &&
        recentHeartbeat(heartbeat)
      ) {
        privacyReady = true;
        break;
      }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (!privacyReady) throw new Error("Private cleanup did not become ready.");
  console.log(
    `Isolated ${production ? "production HTTPS" : "development"} account, render and private cleanup services ready.`,
  );
  if (interrupted) throw new Error("Isolated tests interrupted.");
  tests = spawnTestProcess(
    process.execPath,
    ["node_modules/@playwright/test/cli.js", "test", ...args],
    { env, cwd: app, stdio: "inherit" },
  );
  result = await new Promise<number>((resolve, reject) => {
    tests!.on("error", reject);
    tests!.on("close", (code) => resolve(code ?? 1));
  });
} catch (e) {
  console.error(e instanceof Error ? e.message : "Isolated tests failed.");
} finally {
  process.off("SIGTERM", interrupt);
  process.off("SIGINT", interrupt);
  if (interrupted) result = 1;
  let servicesStopped = false;
  try {
    await shutdownTestProcesses([...services, ...(tests ? [tests] : [])]);
    servicesStopped = true;
  } catch (error) {
    result = 1;
    console.error(
      error instanceof Error ? error.message : "Test process cleanup failed.",
    );
  }
  await tls?.close();
  await log.close();
  if (process.env.E2E_EVIDENCE_DIR) {
    const output = path.resolve(process.env.E2E_EVIDENCE_DIR);
    await mkdir(output, { recursive: true, mode: 0o700 });
    for (const [source, target] of [
      [path.join(app, "test-results"), "test-results"],
      [path.join(dir, "services.log"), "services.log"],
      [path.join(dir, "artifacts"), "artifacts"],
      ...(production
        ? [[path.join(app, ".next", "BUILD_ID"), "BUILD_ID"]]
        : []),
    ]) {
      try {
        await cp(source, path.join(output, target), { recursive: true });
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
      }
    }
  }
  if (servicesStopped) {
    // The source, databases, original media, finished exports and review
    // artifacts remain. Retaining compiled copies/derived clips on tmpfs
    // consumed several GiB across runs and caused real browser OOM crashes.
    // Never remove these paths until every owned service has stopped.
    for (const generated of [
      path.join(app, "node_modules"),
      path.join(app, ".next"),
      path.join(dir, "cache"),
    ])
      await rm(generated, { recursive: true, force: true });
  }
  console.log(`Isolated test artifacts: ${dir}`);
}
process.exitCode = result;
