import Database from "better-sqlite3";
import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { open, lstat, realpath } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { collectExportCensus } from "../src/lib/export-storage-census";
import {
  migrateExportStorage,
  publishExportCensus,
} from "../src/lib/export-storage-store";
import {
  exportStoragePolicy,
  ExportStorageUnavailable,
} from "../src/lib/export-storage-policy";
import { liveNativeRenderJobs } from "../src/lib/render-attempt-processes";
const internal = "REELCHEMY_EXPORT_CENSUS_TOKEN",
  script = fileURLToPath(import.meta.url);
function argumentsFor(values: string[]) {
  const result = new Map<string, string>();
  for (let i = 0; i < values.length; i += 2) {
    if (
      !["--data", "--artifacts"].includes(values[i]) ||
      !values[i + 1] ||
      result.has(values[i])
    )
      throw new Error(
        "Usage: npm run exports:recount -- --data /studio-data --artifacts /exports (stop all writers and back up first).",
      );
    result.set(values[i], values[i + 1]);
  }
  if (result.size !== 2)
    throw new Error(
      "Both --data and --artifacts are required. Stop all writers and back up first.",
    );
  return {
    data: path.resolve(result.get("--data")!),
    artifacts: path.resolve(result.get("--artifacts")!),
  };
}
async function lockFile(file: string) {
  const handle = await open(
    file,
    constants.O_WRONLY |
      constants.O_CREAT |
      constants.O_APPEND |
      constants.O_NOFOLLOW,
    0o600,
  );
  try {
    if (!(await handle.stat()).isFile()) throw new ExportStorageUnavailable();
  } finally {
    await handle.close();
  }
}
async function run() {
  if (process.platform !== "linux")
    throw new Error(
      "Export recount requires the Linux consumer lifecycle locks.",
    );
  let values = process.argv.slice(2),
    locked = false;
  if (values[0] === "--locked") {
    const token = values[1];
    if (!token || token !== process.env[internal])
      throw new Error("Start recount through its lifecycle-lock entrypoint.");
    locked = true;
    values = values.slice(2);
  }
  const supplied = argumentsFor(values),
    data = await realpath(supplied.data),
    artifacts = await realpath(supplied.artifacts);
  if (data === artifacts) throw new ExportStorageUnavailable();
  if (!locked) {
    const render = path.join(data, "worker.lifecycle.lock"),
      ingest = path.join(data, "ingest.lifecycle.lock");
    await lockFile(render);
    await lockFile(ingest);
    const token = randomUUID(),
      environment = { ...process.env, [internal]: token };
    for (const name of Object.keys(environment))
      if (
        name.startsWith("AI_") ||
        name.startsWith("SMTP_") ||
        [
          "BETTER_AUTH_SECRET",
          "BETTER_AUTH_URL",
          "EMAIL_FROM",
          "REELCHEMY_RENDER_JOB_ID",
          "REELCHEMY_RENDER_STUDIO_ROOT",
        ].includes(name)
      )
        delete environment[name];
    const child = spawn(
      "flock",
      [
        "--nonblock",
        "--conflict-exit-code",
        "73",
        "--no-fork",
        render,
        "flock",
        "--nonblock",
        "--conflict-exit-code",
        "73",
        "--no-fork",
        ingest,
        process.execPath,
        "--import",
        "tsx",
        script,
        "--locked",
        token,
        "--data",
        supplied.data,
        "--artifacts",
        artifacts,
      ],
      {
        cwd: path.dirname(path.dirname(script)),
        env: environment,
        stdio: "inherit",
      },
    );
    const stop = (signal: NodeJS.Signals) => {
        if (child.exitCode === null && !child.signalCode) child.kill(signal);
      },
      term = () => stop("SIGTERM"),
      interrupt = () => stop("SIGINT");
    process.on("SIGTERM", term);
    process.on("SIGINT", interrupt);
    try {
      const code = await new Promise<number>((resolve, reject) => {
        child.once("error", reject);
        child.once("close", (code) => resolve(code ?? 1));
      });
      if (code === 73)
        console.error(
          "Stop both consumers before recounting. Their permanent lifecycle locks are still held.",
        );
      process.exitCode = code;
    } finally {
      process.off("SIGTERM", term);
      process.off("SIGINT", interrupt);
    }
    return;
  }
  // The fixed flock entrypoint holds both lifetime inodes until this process
  // exits. Web writers must also be stopped; diagnostics are never removed here.
  for (const name of ["worker.lock", "ingest.lock"]) {
    try {
      await lstat(path.join(data, name));
      throw new Error(
        "Stop all consumers and review any stale diagnostics before recounting. Never remove lifecycle lock inodes.",
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  if (
    (await liveNativeRenderJobs(supplied.data)).size ||
    (supplied.data !== data && (await liveNativeRenderJobs(data)).size)
  )
    throw new Error(
      "An interrupted native render is still active. Stop it before recounting.",
    );
  const file = path.join(data, "studio.sqlite"),
    stat = await lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink())
    throw new ExportStorageUnavailable();
  const db = new Database(file, { fileMustExist: true });
  db.pragma("busy_timeout = 5000");
  const abort = new AbortController(),
    stop = () => abort.abort();
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
  try {
    if (db.pragma("quick_check", { simple: true }) !== "ok")
      throw new ExportStorageUnavailable();
    const policy = exportStoragePolicy();
    migrateExportStorage(db);
    const rows = await collectExportCensus(db, artifacts, abort.signal);
    if (abort.signal.aborted) throw new ExportStorageUnavailable();
    publishExportCensus(db, rows, policy);
    console.log(
      JSON.stringify({
        event: "export.storage.census.complete",
        jobs: rows.length,
        files: rows.reduce((n, row) => n + row.files, 0),
        bytes: rows.reduce((n, row) => n + row.bytes, 0),
      }),
    );
  } finally {
    process.off("SIGTERM", stop);
    process.off("SIGINT", stop);
    db.close();
  }
}
run().catch((error) => {
  console.error(
    error instanceof ExportStorageUnavailable
      ? error.message
      : error instanceof Error && !("code" in error)
        ? error.message
        : "Export storage recount could not finish safely. Review the stopped services and configured storage.",
  );
  process.exitCode = 1;
});
