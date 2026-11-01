import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  INGEST_HEARTBEAT_NAME,
  recentHeartbeat,
} from "../src/lib/worker-heartbeat";
try {
  process.exitCode = recentHeartbeat(
    JSON.parse(
      await readFile(
        path.resolve(
          process.env.REELCHEMY_DATA_DIR || ".data",
          INGEST_HEARTBEAT_NAME,
        ),
        "utf8",
      ),
    ),
  )
    ? 0
    : 1;
} catch {
  process.exitCode = 1;
}
