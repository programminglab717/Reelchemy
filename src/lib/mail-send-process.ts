import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { MailUnavailable, MAIL_RECORD_BYTES } from "./mail-policy";
import type { Mail } from "./mail-outbox";
export const SMTP_SEND_DEADLINE_MS = 45000;
// Socket inactivity timeouts do not bound a trickling server, and Nodemailer's
// non-pool close() does not cancel an active send. Bound the whole sender process
// and wait for its exit before settling or retrying a private queue claim.
export async function sendMailProcess(
  mail: Mail,
  fixture?: { executable: string; deadlineMs: number },
) {
  const body = Buffer.from(JSON.stringify(mail));
  if (body.length > MAIL_RECORD_BYTES) throw new MailUnavailable();
  const environment: NodeJS.ProcessEnv = {};
  for (const key of [
    "PATH",
    "LANG",
    "LC_ALL",
    "TZ",
    "NODE_EXTRA_CA_CERTS",
    "SMTP_HOST",
    "SMTP_PORT",
    "SMTP_USER",
    "SMTP_PASSWORD",
    "EMAIL_FROM",
  ])
    if (process.env[key] !== undefined) environment[key] = process.env[key];
  environment.NODE_ENV = "production";
  const child = spawn(
    process.execPath,
    [
      "--import",
      "tsx",
      fixture?.executable ||
        fileURLToPath(new URL("../../scripts/smtp-send.ts", import.meta.url)),
    ],
    { env: environment, stdio: ["pipe", "pipe", "ignore"] },
  );
  let output = "",
    timedOut = false,
    stdinFailed = false,
    killTimer: ReturnType<typeof setTimeout> | undefined;
  const timer = setTimeout(() => {
    timedOut = true;
    child.kill("SIGTERM");
    killTimer = setTimeout(() => child.kill("SIGKILL"), 2000);
  }, fixture?.deadlineMs ?? SMTP_SEND_DEADLINE_MS);
  try {
    child.stdout.on("data", (chunk) => {
      output += chunk.toString().slice(0, 16);
      if (output.length > 16) {
        timedOut = true;
        child.kill("SIGKILL");
      }
    });
    child.stdin.on("error", () => {
      stdinFailed = true;
    });
    const completed = new Promise<number | null>((resolve, reject) => {
      child.once("error", () => reject(new MailUnavailable()));
      child.once("close", resolve);
    });
    child.stdin.end(body);
    const code = await completed;
    if (code !== 0 || timedOut || stdinFailed || output !== "sent\n")
      throw new MailUnavailable();
  } finally {
    clearTimeout(timer);
    clearTimeout(killTimer);
    body.fill(0);
  }
}
