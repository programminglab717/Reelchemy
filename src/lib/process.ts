import { spawn } from "node:child_process";
export class CommandTimeoutError extends Error {
  constructor() {
    super("Media operation timed out.");
  }
}
export class CommandCancelledError extends Error {
  constructor() {
    super("Render cancelled.");
  }
}
export async function runCommand(
  command: string,
  args: string[],
  options: {
    timeoutMs?: number;
    cancelled?: () => boolean;
    maxOutputBytes?: number;
  } = {},
) {
  if (options.cancelled?.()) throw new CommandCancelledError();
  return new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "",
      stderr = "",
      size = 0,
      failure: Error | undefined,
      killTimer: ReturnType<typeof setTimeout> | undefined;
    const stop = (error: Error) => {
      if (failure) return;
      failure = error;
      child.kill("SIGTERM");
      killTimer = setTimeout(() => child.kill("SIGKILL"), 1000);
    };
    const timer = setTimeout(
      () => stop(new CommandTimeoutError()),
      options.timeoutMs || 60000,
    );
    const poll = options.cancelled
      ? setInterval(() => {
          if (options.cancelled!()) stop(new CommandCancelledError());
        }, 100)
      : undefined;
    const collect = (data: Buffer, stream: "stdout" | "stderr") => {
      size += data.length;
      if (size > (options.maxOutputBytes || 1000000)) {
        stop(new Error("Media command output exceeded its limit."));
        return;
      }
      if (stream === "stdout") stdout += data.toString();
      else stderr += data.toString();
    };
    child.stdout.on("data", (b) => collect(b, "stdout"));
    child.stderr.on("data", (b) => collect(b, "stderr"));
    const cleanup = () => {
      clearTimeout(timer);
      if (poll) clearInterval(poll);
      if (killTimer) clearTimeout(killTimer);
    };
    child.on("error", (e) => {
      cleanup();
      reject(e);
    });
    child.on("close", (code) => {
      cleanup();
      if (failure) reject(failure);
      else if (code !== 0)
        reject(
          new Error(
            `Media operation failed (exit ${code}): ${stderr.slice(-2000)}`,
          ),
        );
      else resolve({ stdout, stderr });
    });
  });
}
