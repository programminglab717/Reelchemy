import { readFile, writeFile, rename, unlink } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { dataDir, mediaProcessing } from "../src/lib/db";
import { mediaProcessingPolicy } from "../src/lib/media-processing-policy";
import {
  cleanMediaProcessing,
  processMediaTask,
  recoverMediaProcessing,
} from "../src/lib/media-processing-worker";
import { INGEST_HEARTBEAT_NAME } from "../src/lib/worker-heartbeat";

if (
  process.platform !== "linux" ||
  process.env.REELCHEMY_INGEST_KERNEL_LOCK !== "1"
)
  throw new Error(
    "Start media processing with npm run ingest:worker so its lifecycle lock is held.",
  );
const lock = path.join(dataDir, "ingest.lock");
try {
  const previous = JSON.parse(await readFile(lock, "utf8"));
  if (previous.kind !== "reelchemy-ingest-lock-v1")
    throw new Error("Media worker diagnostics need operator review.");
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
}
const instanceId = randomUUID(),
  policy = mediaProcessingPolicy();
const diagnostic = `${lock}.${instanceId}.tmp`;
await writeFile(
  diagnostic,
  JSON.stringify({
    kind: "reelchemy-ingest-lock-v1",
    instanceId,
    pid: process.pid,
    startedAt: new Date().toISOString(),
  }),
  { flag: "wx", mode: 0o600 },
);
await rename(diagnostic, lock);
let stopping = false;
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, () => {
    stopping = true;
  });
const heartbeat = path.join(dataDir, INGEST_HEARTBEAT_NAME),
  temporary = `${heartbeat}.${instanceId}.tmp`;
let beating: Promise<void> | undefined;
function beat() {
  if (beating) return beating;
  beating = (async () => {
    try {
      await writeFile(
        temporary,
        JSON.stringify({ at: new Date().toISOString(), instanceId }),
        { mode: 0o600 },
      );
      await rename(temporary, heartbeat);
    } finally {
      beating = undefined;
    }
  })();
  return beating;
}
const timer = setInterval(() => {
  void beat().catch(() => {});
}, 5000);
try {
  recoverMediaProcessing();
  cleanMediaProcessing();
  await beat();
  console.log("Reelchemy media worker ready");
  let previousWorkspace: string | undefined;
  while (!stopping) {
    const task = mediaProcessing.claim(previousWorkspace);
    cleanMediaProcessing();
    if (!task) {
      await new Promise((resolve) => setTimeout(resolve, 300));
      continue;
    }
    previousWorkspace = task.workspaceId;
    console.log(
      JSON.stringify({
        event: "media.start",
        requestId: task.id,
        operation: task.operation,
      }),
    );
    await processMediaTask(task, () => stopping, policy.processingMs);
  }
} finally {
  clearInterval(timer);
  await beating?.catch(() => {});
  for (const file of [temporary, heartbeat, lock]) {
    try {
      await unlink(file);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
}
