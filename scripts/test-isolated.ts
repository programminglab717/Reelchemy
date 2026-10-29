import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, open, mkdir, cp, rm } from "node:fs/promises";
import path from "node:path";
import { constants } from "node:fs";
import { randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
const dir = await mkdtemp(path.join(tmpdir(), "reelchemy-e2e-")),
  port = Number(process.env.E2E_PORT) || 3002,
  baseURL = `http://127.0.0.1:${port}`;
const app = path.join(dir, "app");
await mkdir(app);
// A separate source/dependency mirror also isolates Next's shared next-env/type generation.
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
const env: NodeJS.ProcessEnv = {
  ...process.env,
  NODE_ENV: "development",
  BETTER_AUTH_URL: baseURL,
  BETTER_AUTH_SECRET: randomBytes(48).toString("base64url"),
  AI_PROVIDER: "mock",
  EMAIL_DELIVERY: "file",
  REELCHEMY_DATA_DIR: dir,
  REELCHEMY_ARTIFACT_DIR: path.join(dir, "artifacts"),
  REELCHEMY_RENDER_CACHE_DIR: path.join(dir, "cache"),
  REELCHEMY_NEXT_DIST_DIR: ".next",
  PLAYWRIGHT_BASE_URL: baseURL,
};
delete env.AI_API_KEY;
delete env.SMTP_PASSWORD;
const log = await open(path.join(dir, "services.log"), "a");
const services: ChildProcess[] = [];
const start = (args: string[]) => {
  const child = spawn(process.execPath, args, {
    env,
    cwd: app,
    stdio: ["ignore", log.fd, log.fd],
  });
  services.push(child);
  return child;
};
let result = 1;
try {
  const server = start([
    "node_modules/next/dist/bin/next",
    "dev",
    "--hostname",
    "127.0.0.1",
    "--port",
    String(port),
  ]);
  const worker = start(["--import", "tsx", "scripts/worker.ts"]);
  const deadline = Date.now() + 60000;
  let ready = false;
  while (Date.now() < deadline) {
    if (server.exitCode !== null || worker.exitCode !== null)
      throw new Error("Test services exited before readiness.");
    try {
      const r = await fetch(`${baseURL}/api/projects`, {
        signal: AbortSignal.timeout(2000),
      });
      if (
        r.status === 401 &&
        (
          await fetch(`${baseURL}/api/health`, {
            signal: AbortSignal.timeout(5000),
          })
        ).ok
      ) {
        ready = true;
        break;
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 300));
  }
  if (!ready) throw new Error("Test services did not become ready.");
  console.log("Isolated account and render services ready.");
  const tests = spawn(
    process.execPath,
    ["node_modules/@playwright/test/cli.js", "test", ...process.argv.slice(2)],
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
  await log.close();
  await rm(path.join(app, "node_modules"), { recursive: true, force: true });
  console.log(`Isolated test artifacts: ${dir}`);
}
process.exitCode = result;
