import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import {
  migrateExportStorage,
  exportStorageOperatorUsage,
} from "../src/lib/export-storage-store";
import { exportStoragePolicy } from "../src/lib/export-storage-policy";
import {
  spawnTestProcess,
  shutdownTestProcesses,
} from "../scripts/test-process";
const MiB = 1024 ** 2;
test("separate writer processes cannot overbook shared bytes or export counts and refused transactions leave no phantom jobs", async () => {
  const root = await mkdtemp(
    path.join(tmpdir(), "reelchemy-export-admission-race-"),
  );
  const children: ReturnType<typeof spawnTestProcess>[] = [];
  try {
    for (const mode of ["bytes", "exports"] as const) {
      const file = path.join(root, `${mode}.sqlite`),
        db = new Database(file);
      db.pragma("journal_mode=WAL");
      db.pragma("busy_timeout=5000");
      db.exec(
        "CREATE TABLE projects(id TEXT PRIMARY KEY,workspace_id TEXT,trashed_at TEXT);CREATE TABLE jobs(id TEXT PRIMARY KEY,project_id TEXT,status TEXT);CREATE TABLE project_deletions(project_id TEXT);CREATE TABLE render_job_attempts(job_id TEXT PRIMARY KEY,started_at TEXT)",
      );
      migrateExportStorage(db);
      const policy = {
        ...exportStoragePolicy({}),
        reservationBytes: MiB,
        studioBytes: mode === "bytes" ? 2 * MiB : 8 * MiB,
        serviceBytes: mode === "bytes" ? 3 * MiB : 16 * MiB,
        studioExports: mode === "bytes" ? 10 : 1,
        serviceExports: mode === "bytes" ? 20 : 2,
      };
      const code = `
        import {createRequire} from 'node:module';
        const require=createRequire(${JSON.stringify(path.resolve("package.json"))});
        const Database=require('better-sqlite3');
        const store=await import(${JSON.stringify(pathToFileURL(path.resolve("src/lib/export-storage-store.ts")).href)});
        const db=new Database(process.argv[1]);db.pragma('busy_timeout=5000');
        const policy=JSON.parse(process.argv[2]),owner=process.argv[3],project=process.argv[4],job=process.argv[5];
        try {db.transaction(()=>{
          db.prepare('INSERT INTO projects VALUES(?,?,NULL)').run(project,owner);
          db.prepare("INSERT INTO jobs VALUES(?,?,'queued')").run(job,project);
          store.reserveExportStorage(db,job,project,owner,policy);
        }).immediate();process.stdout.write('admitted');}
        catch(error){if(error.code==='EXPORT_STORAGE_LIMIT')process.stdout.write('refused');else throw error;}
        finally {db.close();}
      `;
      const results = await Promise.all(
        Array.from({ length: 6 }, async (_, index) => {
          const child = spawnTestProcess(
            process.execPath,
            [
              "--import",
              "tsx",
              "--input-type=module",
              "-e",
              code,
              file,
              JSON.stringify(policy),
              index % 2 ? "other" : "owner",
              randomUUID(),
              randomUUID(),
            ],
            {
              env: { PATH: process.env.PATH, NODE_ENV: "test" },
              stdio: ["ignore", "pipe", "pipe"],
            },
          );
          children.push(child);
          let output = "",
            errors = "";
          child.stdout?.on("data", (bytes) => {
            output += bytes.toString();
          });
          child.stderr?.on("data", (bytes) => {
            errors += bytes.toString();
          });
          const status = await new Promise<number | null>((resolve, reject) => {
            child.once("error", reject);
            child.once("close", resolve);
          });
          assert.equal(status, 0, errors);
          assert(["admitted", "refused"].includes(output));
          return output;
        }),
      );
      const accepted = mode === "bytes" ? 3 : 2;
      assert.equal(results.filter((r) => r === "admitted").length, accepted);
      const total = exportStorageOperatorUsage(db, undefined, policy);
      assert.equal(total.reservedBytes, accepted * MiB);
      assert.equal(total.chargedExports, accepted);
      for (const owner of ["owner", "other"]) {
        const own = exportStorageOperatorUsage(db, owner, policy);
        assert(own.reservedBytes <= policy.studioBytes);
        assert(own.chargedExports <= policy.studioExports);
      }
      assert.equal(
        (db.prepare("SELECT count(*) AS n FROM jobs").get() as { n: number }).n,
        accepted,
      );
      assert.equal(
        (
          db.prepare("SELECT count(*) AS n FROM projects").get() as {
            n: number;
          }
        ).n,
        accepted,
      );
      db.close();
    }
  } finally {
    await shutdownTestProcesses(children);
    await rm(root, { recursive: true, force: true });
  }
});
