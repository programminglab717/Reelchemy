import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, open, mkdir, cp, rm, access } from "node:fs/promises";
import path from "node:path";
import { constants } from "node:fs";
import { randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import { testTls } from "./test-tls";
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
await cp(path.resolve("node_modules"), path.join(app, "node_modules"), {
  recursive: true,
  mode: constants.COPYFILE_FICLONE,
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
let result = 1;
try {
  if (production) tls = await testTls(port, dir);
  const baseURL = tls?.origin || `http://127.0.0.1:${port}`;
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
    REELCHEMY_MEDIA_REQUESTS_PER_HOUR: "30",
    REELCHEMY_PLANS_PER_DAY: "60",
    REELCHEMY_EXPORT_REQUESTS_PER_DAY: "30",
    REELCHEMY_DATA_DIR: dir,
    REELCHEMY_ARTIFACT_DIR: path.join(dir, "artifacts"),
    REELCHEMY_RENDER_CACHE_DIR: path.join(dir, "cache"),
    REELCHEMY_NEXT_DIST_DIR: ".next",
    RAYON_NUM_THREADS: "2",
    PLAYWRIGHT_BASE_URL: baseURL,
  };
  delete env.AI_API_KEY;
  delete env.SMTP_PASSWORD;
  const start = (arguments_: string[]) => {
    const child = spawn(process.execPath, arguments_, {
      env,
      cwd: app,
      stdio: ["ignore", log.fd, log.fd],
    });
    services.push(child);
    return child;
  };
  if (production) {
    const migration = start(["--import", "tsx", "scripts/auth-migrate.ts"]);
    const code = await new Promise<number | null>((resolve, reject) => {
      migration.once("error", reject);
      migration.once("close", resolve);
    });
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
  const worker = start(["--import", "tsx", "scripts/worker-entrypoint.ts"]);
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
    if (server.exitCode !== null || worker.exitCode !== null)
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
  console.log(
    `Isolated ${production ? "production HTTPS" : "development"} account and render services ready.`,
  );
  const tests = spawn(
    process.execPath,
    ["node_modules/@playwright/test/cli.js", "test", ...args],
    { env, cwd: app, stdio: "inherit" },
  );
  result = await new Promise<number>((resolve, reject) => {
    tests.on("error", reject);
    tests.on("close", (code) => resolve(code ?? 1));
  });
} catch (e) {
  console.error(e instanceof Error ? e.message : "Isolated tests failed.");
} finally {
  for (const child of services) child.kill("SIGTERM");
  await Promise.all(
    services.map(
      (child) =>
        new Promise<void>((resolve) => {
          if (child.exitCode !== null) {
            resolve();
            return;
          }
          const timer = setTimeout(() => {
            child.kill("SIGKILL");
            resolve();
          }, 5000);
          child.once("close", () => {
            clearTimeout(timer);
            resolve();
          });
        }),
    ),
  );
  await tls?.close();
  await log.close();
  if (process.env.E2E_EVIDENCE_DIR) {
    const output = path.resolve(process.env.E2E_EVIDENCE_DIR);
    await mkdir(output, { recursive: true, mode: 0o700 });
    for (const [source, target] of [
      [path.join(app, "test-results"), "test-results"],
      [path.join(dir, "services.log"), "services.log"],
      [path.join(dir, "artifacts"), "artifacts"],
    ]) {
      try {
        await cp(source, path.join(output, target), { recursive: true });
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
      }
    }
  }
  await rm(path.join(app, "node_modules"), { recursive: true, force: true });
  console.log(`Isolated test artifacts: ${dir}`);
}
process.exitCode = result;
