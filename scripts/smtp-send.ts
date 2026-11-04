import nodemailer from "nodemailer";
import { mailConfig } from "../src/lib/mail";
import { MAIL_RECORD_BYTES, MailUnavailable } from "../src/lib/mail-policy";
import { SMTP_SEND_DEADLINE_MS } from "../src/lib/mail-send-process";
import type { Mail } from "../src/lib/mail-outbox";
// This private child alone opens the SMTP connection. Even if its queue parent
// dies, its independent watchdog closes the process and every socket.
const watchdog = setTimeout(() => process.exit(1), SMTP_SEND_DEADLINE_MS);
try {
  if (mailConfig() !== "smtp") throw new MailUnavailable();
  let bytes = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    bytes += chunk.length;
    if (bytes > MAIL_RECORD_BYTES) throw new MailUnavailable();
    chunks.push(Buffer.from(chunk));
  }
  const message: Mail = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  if (
    typeof message.to !== "string" ||
    typeof message.subject !== "string" ||
    typeof message.text !== "string"
  )
    throw new MailUnavailable();
  const port = Number(process.env.SMTP_PORT) || 587;
  const transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure: port === 465,
    requireTLS: true,
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 15000,
    dnsTimeout: 10000,
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
    await transport.sendMail({
      to: message.to,
      subject: message.subject,
      text: message.text,
      from: process.env.EMAIL_FROM,
    });
    process.stdout.write("sent\n");
  } finally {
    transport.close();
  }
} catch {
  process.exitCode = 1;
} finally {
  clearTimeout(watchdog);
}
