import {
  mkdir,
  writeFile,
  readdir,
  readFile,
  unlink,
  rename,
} from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import nodemailer from "nodemailer";
import { authStorageDirectory } from "./auth-storage";
export type Mail = { to: string; subject: string; text: string };
export function mailConfig(
  env: Record<string, string | undefined> = process.env,
) {
  const delivery =
    env.EMAIL_DELIVERY || (env.NODE_ENV === "production" ? "smtp" : "file");
  if (delivery === "file" && env.NODE_ENV === "production")
    throw new Error("File mail delivery is disabled in production.");
  if (!["file", "smtp"].includes(delivery))
    throw new Error("Invalid email delivery configuration.");
  if (delivery === "smtp" && (!env.SMTP_HOST || !env.EMAIL_FROM))
    throw new Error(
      "Production email delivery requires SMTP_HOST and EMAIL_FROM.",
    );
  return delivery;
}
export function mailDir() {
  return path.join(authStorageDirectory(), "mail");
}
export async function deliverMail(mail: Mail) {
  mailConfig();
  const dir = mailDir();
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await writeFile(
    path.join(dir, `${randomUUID()}.json`),
    JSON.stringify({
      ...mail,
      createdAt: new Date().toISOString(),
      attempts: 0,
      nextAttemptAt: 0,
    }),
    { mode: 0o600, flag: "wx" },
  );
}
async function sendSMTP(mail: Mail) {
  mailConfig();
  const port = Number(process.env.SMTP_PORT) || 587;
  const transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure: port === 465,
    requireTLS: true,
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 15000,
    ...(process.env.SMTP_USER
      ? {
          auth: {
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASSWORD,
          },
        }
      : {}),
  });
  try {
    await transport.sendMail({ ...mail, from: process.env.EMAIL_FROM });
  } finally {
    transport.close();
  }
}
export async function flushOutbox(
  send: (mail: Mail) => Promise<void> = sendSMTP,
) {
  const dir = mailDir();
  await mkdir(dir, { recursive: true, mode: 0o700 });
  let sent = 0,
    failed = 0;
  for (const file of (await readdir(dir)).filter((f) =>
    /^[a-f0-9-]{36}\.json$/.test(f),
  )) {
    const target = path.join(dir, file);
    const item = JSON.parse(await readFile(target, "utf8"));
    if (item.nextAttemptAt > Date.now()) continue;
    if (
      Date.now() - Date.parse(item.createdAt) > 3600000 ||
      item.attempts >= 5
    ) {
      await mkdir(path.join(dir, "failed"), { recursive: true, mode: 0o700 });
      await rename(target, path.join(dir, "failed", file));
      failed++;
      continue;
    }
    try {
      await send({ to: item.to, subject: item.subject, text: item.text });
      await unlink(target);
      sent++;
    } catch {
      item.attempts++;
      item.nextAttemptAt =
        Date.now() + Math.min(300000, 30000 * 2 ** (item.attempts - 1));
      await writeFile(target, JSON.stringify(item), { mode: 0o600 });
      failed++;
    }
  }
  return { sent, failed };
}
