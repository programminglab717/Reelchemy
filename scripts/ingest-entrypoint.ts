import { spawn } from "node:child_process";
import { mkdir, open } from "node:fs/promises";
import path from "node:path";
if (process.platform !== "linux")
  throw new Error("Media ingestion requires the Linux kernel-lock entrypoint.");
const directory = path.resolve(process.env.REELCHEMY_DATA_DIR || ".data");
await mkdir(directory, { recursive: true, mode: 0o700 });
// Permanent inode: never unlink this file when stopping or recovering a worker.
const lifecycle = path.join(directory, "ingest.lifecycle.lock");
const file = await open(lifecycle, "a", 0o600);
await file.close();
const child = spawn(
  "flock",
  [
    "--nonblock",
    "--conflict-exit-code",
    "73",
    "--no-fork",
    lifecycle,
    process.execPath,
    "--import",
    "tsx",
    "scripts/ingest-worker.ts",
  ],
  {
    stdio: "inherit",
    env: { ...process.env, REELCHEMY_INGEST_KERNEL_LOCK: "1" },
  },
);
let forced: ReturnType<typeof setTimeout> | undefined;
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, () => {
    if (child.exitCode !== null || child.signalCode) return;
    child.kill(signal);
    forced ??= setTimeout(() => child.kill("SIGKILL"), 10000);
    forced.unref();
  });
child.on("error", () => {
  console.error("Media worker entrypoint failed.");
  process.exitCode = 1;
});
child.on("close", (code) => {
  clearTimeout(forced);
  if (code === 73)
    console.error(
      "Another media worker holds the shared ingestion lifecycle lock.",
    );
  process.exitCode = code === 0 ? 0 : 1;
});
