import Database from "better-sqlite3";
import path from "node:path";
import { ProviderUsageStore } from "../src/lib/provider-usage-store";

const args = process.argv.slice(2);
if (
  args.length !== 4 ||
  args[0] !== "--request" ||
  !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(args[1]) ||
  args[2] !== "--confirmed-usd" ||
  !/^(0|[1-9]\d{0,6})(?:\.\d{1,6})?$/.test(args[3])
)
  throw new Error(
    "Usage: npm run ai:reconcile -- --request UUID --confirmed-usd AMOUNT (only after verifying the provider's actual charge or confirmed no-charge).",
  );
const [whole, fraction = ""] = args[3].split(".");
const cost = Number(
  BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, "0")),
);
const db = new Database(
  path.join(
    path.resolve(process.env.REELCHEMY_DATA_DIR || ".data"),
    "studio.sqlite",
  ),
  { fileMustExist: true },
);
db.pragma("busy_timeout = 5000");
try {
  if (
    !db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='provider_usage'",
      )
      .get()
  )
    throw new Error(
      "Provider usage has not been migrated; no receipt changed.",
    );
  if (!new ProviderUsageStore(db).reconcile(args[1], cost))
    throw new Error(
      "No unresolved request outside its active deadline matched; no receipt changed.",
    );
  console.log(
    "Recorded operator-confirmed cost for the unresolved request. Its receipt is now immutable.",
  );
} finally {
  db.close();
}
