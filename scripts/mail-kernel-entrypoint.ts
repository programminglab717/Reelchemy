import { spawn } from "node:child_process";
import { constants, openSync, closeSync, fstatSync } from "node:fs";
import path from "node:path";
import { withPrivateDirectory } from "../src/lib/private-directory";
// Fixed by the entrypoint, never request/environment input. Explicit test
// fixtures call this same helper with their fake consumer, which has no SMTP.
export function mailKernelEntrypoint(directory: string, executable: string) {
  if (process.platform !== "linux")
    throw new Error("Account mail requires the Linux kernel-lock entrypoint.");
  const child = withPrivateDirectory(
    path.dirname(directory),
    path.basename(directory),
    (anchor) => {
      const file = openSync(
        path.join(anchor, "worker.lifecycle.lock"),
        constants.O_WRONLY |
          constants.O_CREAT |
          constants.O_NOFOLLOW |
          constants.O_NONBLOCK,
        0o600,
      );
      try {
        const info = fstatSync(file);
        if (!info.isFile() || info.nlink !== 1)
          throw new Error("Mail lifecycle lock unavailable.");
        return spawn(
          "flock",
          [
            "--nonblock",
            "--conflict-exit-code",
            "73",
            "--no-fork",
            "/proc/self/fd/3",
            process.execPath,
            "--import",
            "tsx",
            executable,
          ],
          {
            stdio: ["inherit", "inherit", "inherit", file],
            env: { ...process.env, REELCHEMY_MAIL_KERNEL_LOCK: "1" },
          },
        );
      } finally {
        closeSync(file);
      }
    },
  );
  let forced: ReturnType<typeof setTimeout> | undefined;
  for (const signal of ["SIGINT", "SIGTERM"] as const)
    process.on(signal, () => {
      if (child.exitCode !== null || child.signalCode) return;
      child.kill(signal);
      forced ??= setTimeout(() => child.kill("SIGKILL"), 60000);
      forced.unref();
    });
  child.on("error", () => {
    console.error("Account mail entrypoint failed.");
    process.exitCode = 1;
  });
  child.on("close", (code) => {
    clearTimeout(forced);
    if (code === 73)
      console.error("Another mail worker holds the shared lifecycle lock.");
    process.exitCode = code === 0 ? 0 : 1;
  });
  return child;
}
