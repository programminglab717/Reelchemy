import { readFile } from "node:fs/promises";
import path from "node:path";
import { HEARTBEAT_NAME, recentHeartbeat } from "../src/lib/worker-heartbeat";
try {
  const file = path.resolve(
    process.env.REELCHEMY_DATA_DIR || ".data",
    HEARTBEAT_NAME,
  );
  process.exitCode = recentHeartbeat(JSON.parse(await readFile(file, "utf8")))
    ? 0
    : 1;
} catch {
  process.exitCode = 1;
}
