import Database from "better-sqlite3";
import path from "node:path";
import { providerUsageSummary } from "../src/lib/provider-usage-store";

const args = process.argv.slice(2);
let workspaceId: string | undefined;
if (
  args.length === 2 &&
  args[0] === "--workspace" &&
  /^[A-Za-z0-9_-]{1,80}$/.test(args[1])
)
  workspaceId = args[1];
else if (args.length)
  throw new Error("Usage: npm run ai:usage -- [--workspace ID]");
const db = new Database(
  path.join(
    path.resolve(process.env.REELCHEMY_DATA_DIR || ".data"),
    "studio.sqlite",
  ),
  { readonly: true, fileMustExist: true },
);
try {
  console.log(JSON.stringify(providerUsageSummary(db, workspaceId), null, 2));
} finally {
  db.close();
}
