import path from "node:path";
import { sendMailProcess } from "./mail-send-process";
import { authStorageDirectory } from "./auth-storage";
import { enqueueMail, claimMail, settleMail, type Mail } from "./mail-outbox";
import { MAIL_BATCH_SIZE, MailUnavailable, mailPolicy } from "./mail-policy";
export type { Mail } from "./mail-outbox";
export function mailConfig(
  env: Record<string, string | undefined> = process.env,
) {
  mailPolicy(env);
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
  if (delivery === "smtp") {
    const port = env.SMTP_PORT;
    if (port && (!/^[1-9][0-9]{0,4}$/.test(port) || Number(port) > 65535))
      throw new MailUnavailable();
    if (
      !/^[a-zA-Z0-9.:-]+$/.test(env.SMTP_HOST!) ||
      env.SMTP_HOST!.length > 253 ||
      /[\r\n\0]/.test(env.EMAIL_FROM!) ||
      env.EMAIL_FROM!.length > 512 ||
      !env.EMAIL_FROM!.includes("@")
    )
      throw new MailUnavailable();
  }
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
  await sendMailProcess(mail);
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
