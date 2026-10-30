import { spawn } from "node:child_process";
import { mkdir, open } from "node:fs/promises";
import path from "node:path";
const directory = path.resolve(process.env.REELCHEMY_DATA_DIR || ".data");
await mkdir(directory, { recursive: true, mode: 0o700 });
const linux = process.platform === "linux";
if (!linux && process.env.NODE_ENV === "production")
  throw new Error(
    "Production rendering requires the Linux container worker entrypoint.",
  );
const lifecycle = path.join(directory, "worker.lifecycle.lock");
if (linux) {
  const file = await open(lifecycle, "a", 0o600);
  await file.close();
}
const worker = [process.execPath, "--import", "tsx", "scripts/worker.ts"];
const fallbackEnv = { ...process.env };
delete fallbackEnv.REELCHEMY_WORKER_KERNEL_LOCK;
const child = linux
  ? spawn(
      "flock",
      [
        "--nonblock",
        "--conflict-exit-code",
        "73",
        "--no-fork",
        lifecycle,
        ...worker,
      ],
      {
        stdio: "inherit",
        env: { ...process.env, REELCHEMY_WORKER_KERNEL_LOCK: "1" },
      },
    )
  : spawn(worker[0], worker.slice(1), { stdio: "inherit", env: fallbackEnv });
let forced: ReturnType<typeof setTimeout> | undefined;
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, () => {
    if (child.exitCode !== null || child.signalCode) return;
    child.kill(signal);
    forced ??= setTimeout(() => child.kill("SIGKILL"), 10000);
    forced.unref();
  });
child.on("error", (error) => {
  console.error(`Worker entrypoint failed: ${error.message}`);
  process.exitCode = 1;
});
child.on("close", (code) => {
  clearTimeout(forced);
  if (code === 73)
    console.error("Another render worker holds the shared lifecycle lock.");
  process.exitCode = code === 0 ? 0 : 1;
});
