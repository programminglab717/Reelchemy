import path from "node:path";
import nodemailer from "nodemailer";
import { authStorageDirectory } from "./auth-storage";
import { enqueueMail, claimMail, settleMail, type Mail } from "./mail-outbox";
import { MAIL_BATCH_SIZE, MailUnavailable } from "./mail-policy";
export type { Mail } from "./mail-outbox";
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
  enqueueMail(mail);
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
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        transport.sendMail({
          to: mail.to,
          subject: mail.subject,
          text: mail.text,
          from: process.env.EMAIL_FROM,
        }),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            transport.close();
            reject(new MailUnavailable());
          }, 45000);
          timer.unref();
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  } finally {
    transport.close();
  }
}
// Production runs under the permanent kernel lifecycle lock. Per-message
// persisted leases also protect concurrent local callers and crash recovery.
export async function flushOutbox(
  send: (mail: Mail) => Promise<void> = sendSMTP,
  options: { shouldStop?: () => boolean } = {},
) {
  let sent = 0,
    failed = 0;
  for (
    let index = 0;
    index < MAIL_BATCH_SIZE && !options.shouldStop?.();
    index++
  ) {
    const claim = claimMail();
    if (!claim) break;
    let delivered = false;
    try {
      await send(claim.mail);
      delivered = true;
    } catch {
      /* Fixed counts only; never log private URLs or SMTP errors. */
    }
    if (!settleMail(claim, delivered)) throw new MailUnavailable();
    if (delivered) sent++;
    else failed++;
  }
  return { sent, failed };
}
