import { spawn } from "node:child_process";
import { constants, openSync, closeSync, fstatSync, fchmodSync } from "node:fs";
import path from "node:path";
import { withPrivateDirectory } from "../src/lib/private-directory";
// Fixed by the entrypoint, never request/environment input. Explicit test
// fixtures call this same helper with their fake consumer, which has no SMTP.
export function privateKernelEntrypoint(
  directory: string,
  executable: string,
  role: "mail" | "privacy",
) {
  if (process.platform !== "linux")
    throw new Error(
      `Account ${role} requires the Linux kernel-lock entrypoint.`,
    );
  const env = { ...process.env };
  if (role === "privacy")
    for (const key of Object.keys(env))
      if (
        key.startsWith("SMTP_") ||
        key.startsWith("AI_") ||
        key.startsWith("EMAIL_") ||
        key.startsWith("BETTER_AUTH_")
      )
        delete env[key];
  env[
    role === "mail"
      ? "REELCHEMY_MAIL_KERNEL_LOCK"
      : "REELCHEMY_PRIVACY_KERNEL_LOCK"
  ] = "1";
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
        fchmodSync(file, 0o600);
        if (!info.isFile() || info.nlink !== 1)
          throw new Error(`Account ${role} lifecycle lock unavailable.`);
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
            env,
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
    console.error(`Account ${role} entrypoint failed.`);
    process.exitCode = 1;
  });
  child.on("close", (code) => {
    clearTimeout(forced);
    if (code === 73)
      console.error(`Another ${role} worker holds the shared lifecycle lock.`);
    process.exitCode = code === 0 ? 0 : 1;
  });
  return child;
}
export function mailKernelEntrypoint(directory: string, executable: string) {
  return privateKernelEntrypoint(directory, executable, "mail");
}
