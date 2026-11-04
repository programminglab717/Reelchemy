import path from "node:path";
import { mailOutboxStatus } from "../src/lib/mail-outbox";
// Explicit operator path; never infer an actual installation from the cwd.
const args = process.argv.slice(2);
if (args.length !== 2 || args[0] !== "--auth" || !args[1]) {
  console.error("Usage: npm run mail:status -- --auth /absolute/private-auth");
  process.exitCode = 1;
} else {
  process.env.REELCHEMY_AUTH_DIR = path.resolve(args[1]);
  try {
    console.log(
      JSON.stringify({ version: 1, mail: mailOutboxStatus() }, null, 2),
    );
  } catch {
    console.error(
      "Account mail inspection unavailable. Check configuration, paths and private queue integrity.",
    );
    process.exitCode = 1;
  }
}
