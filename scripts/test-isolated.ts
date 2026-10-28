import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, open } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
const dir = await mkdtemp(path.join(tmpdir(), "reelchemy-e2e-")),
  port = Number(process.env.E2E_PORT) || 3002,
  baseURL = `http://127.0.0.1:${port}`;
const env: NodeJS.ProcessEnv = {
  ...process.env,
  NODE_ENV: "development",
  BETTER_AUTH_URL: baseURL,
  EMAIL_DELIVERY: "file",
  REELCHEMY_DATA_DIR: dir,
  REELCHEMY_ARTIFACT_DIR: path.join(dir, "artifacts"),
  REELCHEMY_RENDER_CACHE_DIR: path.join(dir, "cache"),
  REELCHEMY_NEXT_DIST_DIR: ".next-e2e",
  PLAYWRIGHT_BASE_URL: baseURL,
};
const log = await open(path.join(dir, "services.log"), "a");
const services: ChildProcess[] = [];
const start = (args: string[]) => {
  const child = spawn(process.execPath, args, {
    env,
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
      if (r.status === 401) {
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
    { env, stdio: "inherit" },
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
  console.log(`Isolated test artifacts: ${dir}`);
}
process.exitCode = result;
