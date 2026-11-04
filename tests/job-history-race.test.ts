import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { migrateMediaReferences } from "../src/lib/media-references";
import {
  migrateJobHistoryStorage,
  jobHistoryOperatorUsage,
} from "../src/lib/job-history-store";
import {
  jobHistoryPolicy,
  jobDocumentReservationBytes,
} from "../src/lib/job-history-policy";
import {
  spawnTestProcess,
  shutdownTestProcesses,
} from "../scripts/test-process";
test("separate producers cannot overbook report bytes or detailed-record counts and refused admissions leave no partial holds", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "reelchemy-history-race-")),
    children: ReturnType<typeof spawnTestProcess>[] = [];
  try {
    for (const mode of ["bytes", "jobs"] as const) {
      const file = path.join(root, `${mode}.sqlite`),
        db = new Database(file),
        slot = jobDocumentReservationBytes;
      db.pragma("journal_mode=WAL");
      db.pragma("busy_timeout=5000");
      db.exec(
        "CREATE TABLE projects(id TEXT PRIMARY KEY,data TEXT,workspace_id TEXT,trashed_at TEXT);CREATE TABLE jobs(id TEXT PRIMARY KEY,project_id TEXT,status TEXT,data TEXT,timeline TEXT);CREATE TABLE render_job_attempts(job_id TEXT PRIMARY KEY,started_at TEXT);CREATE TABLE project_deletions(project_id TEXT)",
      );
      migrateMediaReferences(db);
      migrateJobHistoryStorage(db);
      const policy = {
        ...jobHistoryPolicy({}),
        studioBytes: mode === "bytes" ? 2 * slot : 8 * slot,
        serviceBytes: mode === "bytes" ? 3 * slot : 16 * slot,
        studioJobs: mode === "bytes" ? 10 : 1,
        serviceJobs: mode === "bytes" ? 20 : 2,
      };
      const code = `import {createRequire} from 'node:module';
        const require=createRequire(${JSON.stringify(path.resolve("package.json"))}),Database=require('better-sqlite3'),store=await import(${JSON.stringify(pathToFileURL(path.resolve("src/lib/job-history-store.ts")).href)});
        const db=new Database(process.argv[1]);db.pragma('busy_timeout=5000');
        const policy=JSON.parse(process.argv[2]),owner=process.argv[3],project=process.argv[4],job=process.argv[5];
        try{db.transaction(()=>{
          db.prepare("INSERT INTO projects VALUES(?,'{}',?,NULL)").run(project,owner);
          store.reserveJobHistory(db,job,project,owner,policy);
          db.prepare("INSERT INTO jobs VALUES(?,?,'queued','{}','{}')").run(job,project);
        }).immediate();process.stdout.write('admitted');}
        catch(error){if(error.code==='JOB_HISTORY_LIMIT')process.stdout.write('refused');else throw error;}finally{db.close();}`;
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
      const accepted = mode === "bytes" ? 3 : 2,
        total = jobHistoryOperatorUsage(db, undefined, policy);
      assert.equal(
        results.filter((value) => value === "admitted").length,
        accepted,
      );
      assert.equal(total.bytes + total.reservedBytes, accepted * slot);
      assert.equal(total.fullJobs, accepted);
      assert.equal(total.pendingJobs, accepted);
      for (const owner of ["owner", "other"]) {
        const own = jobHistoryOperatorUsage(db, owner, policy);
        assert(own.fullJobs <= policy.studioJobs);
        assert(own.bytes + own.reservedBytes <= policy.studioBytes);
      }
      for (const table of ["jobs", "projects", "job_history_sizes"])
        assert.equal(
          (
            db.prepare(`SELECT count(*) AS n FROM ${table}`).get() as {
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
