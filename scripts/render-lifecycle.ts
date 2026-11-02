import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { mkdir, open } from "node:fs/promises";
import path from "node:path";
import { CacheRetentionUnavailable } from "../src/lib/cache-retention-policy";
export function renderToolEnvironment(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { NODE_ENV: process.env.NODE_ENV };
  for (const name of [
    "PATH",
    "LANG",
    "TMPDIR",
    "CHROMIUM_PATH",
    "RENDER_CONCURRENCY",
    "REELCHEMY_DATA_DIR",
    "REELCHEMY_AUTH_DIR",
    "REELCHEMY_ARTIFACT_DIR",
    "REELCHEMY_RENDER_CACHE_DIR",
    "REELCHEMY_SCENE_CACHE_BYTES",
    "REELCHEMY_SCENE_CACHE_BYTES_PER_STUDIO",
    "REELCHEMY_SCENE_CACHE_ENTRIES",
    "REELCHEMY_SCENE_CACHE_DAYS",
  ])
    if (process.env[name] !== undefined) env[name] = process.env[name];
  return env;
}
export async function runWithRenderLifecycle(
  command: string[],
  env: NodeJS.ProcessEnv,
  busyMessage: string,
) {
  if (process.platform !== "linux") throw new CacheRetentionUnavailable();
  const directory = path.resolve(process.env.REELCHEMY_DATA_DIR || ".data");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  // Pin the permanent inode without truncating, unlinking or replacing it.
  const file = await open(
    path.join(directory, "worker.lifecycle.lock"),
    constants.O_RDWR | constants.O_CREAT | constants.O_NOFOLLOW,
    0o600,
  );
  try {
    if (!(await file.stat()).isFile()) throw new CacheRetentionUnavailable();
    const child = spawn(
      "flock",
      [
        "--nonblock",
        "--conflict-exit-code",
        "73",
        "--no-fork",
        `/proc/${process.pid}/fd/${file.fd}`,
        process.execPath,
        "--import",
        "tsx",
        ...command,
      ],
      { env, stdio: "inherit" },
    );
    const forward = (signal: NodeJS.Signals) => {
      if (child.exitCode === null && !child.signalCode) child.kill(signal);
    };
    const interrupt = () => forward("SIGINT"),
      terminate = () => forward("SIGTERM");
    process.on("SIGINT", interrupt);
    process.on("SIGTERM", terminate);
    try {
      const code = await new Promise<number | null>((resolve, reject) => {
        child.once("close", resolve);
        child.once("error", reject);
      });
      if (code === 73) console.error(busyMessage);
      return code === 0 ? 0 : 1;
    } finally {
      process.off("SIGINT", interrupt);
      process.off("SIGTERM", terminate);
    }
  } finally {
    await file.close();
  }
}
export async function assertNoLegacyRenderWorker() {
  let file;
  try {
    file = await open(
      path.join(process.env.REELCHEMY_DATA_DIR || ".data", "worker.lock"),
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    const stat = await file.stat();
    if (!stat.isFile() || stat.size < 1 || stat.size > 4096)
      throw new CacheRetentionUnavailable();
    const bytes = Buffer.alloc(stat.size);
    if ((await file.read(bytes, 0, bytes.length, 0)).bytesRead !== bytes.length)
      throw new CacheRetentionUnavailable();
    const text = bytes.toString();
    try {
      if (JSON.parse(text).kind === "reelchemy-worker-lock-v2") return;
    } catch {
      /* Legacy locks are plain PIDs. */
    }
    const pid = Number(text.trim());
    if (!Number.isInteger(pid) || pid < 2)
      throw new CacheRetentionUnavailable();
    try {
      process.kill(pid, 0);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ESRCH") return;
      throw error;
    }
    throw new CacheRetentionUnavailable();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  } finally {
    await file?.close();
  }
}
