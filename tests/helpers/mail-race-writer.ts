import { enqueueMail } from "../../src/lib/mail-outbox";
import { MailCapacity } from "../../src/lib/mail-policy";
process.stdin.once("data", () => {
  try {
    enqueueMail({
      to: `${process.env.MAIL_TEST_WRITER}@example.test`,
      subject: "Verify",
      text: "a".repeat(Number(process.env.MAIL_TEST_TEXT_BYTES)),
    });
    process.stdout.write("admitted\n");
  } catch (error) {
    process.stdout.write(
      error instanceof MailCapacity ? "capacity\n" : "unavailable\n",
    );
  }
  process.stdin.pause();
});
process.stdout.write("ready\n");
