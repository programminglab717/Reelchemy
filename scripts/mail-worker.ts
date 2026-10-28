import { open, unlink } from "node:fs/promises";
import path from "node:path";
import { mailConfig, mailDir, flushOutbox } from "../src/lib/mail";
import { mkdir } from "node:fs/promises";
if (mailConfig() !== "smtp")
  throw new Error(
    "Mail worker requires SMTP delivery; development file delivery stays in the private mailbox.",
  );
await mkdir(mailDir(), { recursive: true, mode: 0o700 });
const lock = path.join(mailDir(), "worker.lock");
const handle = await open(lock, "wx");
await handle.writeFile(String(process.pid));
await handle.close();
let stop = false;
process.on("SIGTERM", () => {
  stop = true;
});
process.on("SIGINT", () => {
  stop = true;
});
console.log("Account mail worker ready");
try {
  while (!stop) {
    const result = await flushOutbox();
    if (result.sent || result.failed)
      console.log(JSON.stringify({ event: "mail.batch", ...result }));
    await new Promise((r) => setTimeout(r, 1000));
  }
} finally {
  await unlink(lock);
}
