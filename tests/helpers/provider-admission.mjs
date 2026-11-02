import { parentPort, workerData } from "node:worker_threads";
import Database from "better-sqlite3";
import { tsImport } from "tsx/esm/api";
const { ProviderUsageStore } = await tsImport(
  "../../src/lib/provider-usage-store.ts",
  import.meta.url,
);
const db = new Database(workerData.file);
db.pragma("busy_timeout = 5000");
try {
  const store = new ProviderUsageStore(db);
  parentPort.postMessage({ ready: true });
  if (
    Atomics.wait(new Int32Array(workerData.gate), 0, 0, 10000) === "timed-out"
  )
    throw new Error("Admission fixture barrier timed out.");
  try {
    parentPort.postMessage({
      id: store.reserve(
        workerData.workspace,
        workerData.input,
        workerData.policy,
      ),
    });
  } catch (error) {
    parentPort.postMessage({ code: error.code });
  }
} finally {
  db.close();
}
