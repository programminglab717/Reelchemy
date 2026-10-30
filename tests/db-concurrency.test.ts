import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, access, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import Database from "better-sqlite3";
import { blankTimeline } from "../src/lib/editor";
const dir = await mkdtemp(path.join(tmpdir(), "reelchemy-contention-"));
process.env.REELCHEMY_DATA_DIR = dir;
process.env.REELCHEMY_ARTIFACT_DIR = path.join(dir, "artifacts");
const db = await import("../src/lib/db");
test(
  "real concurrent writers cannot turn render progress/stages into WAL snapshot upgrade failures",
  { timeout: 45000 },
  async () => {
    const p = db.createProject({
      prompt: "Concurrent progress fixture",
      duration: 5,
      format: "landscape",
    });
    db.reviseProject(p, blankTimeline(p.brief), "Fixture");
    const job = db.createJob(p);
    db.claimJob();
    const children: ChildProcess[] = [];
    const start = path.join(dir, "start");
    try {
      const results = Array.from({ length: 3 }, (_, index) => {
        const source = `
        import {access,writeFile} from 'node:fs/promises';
        import Database from 'better-sqlite3';
        const db=await import(${JSON.stringify(pathToFileURL(path.resolve("src/lib/db.ts")).href)});
        const raw=new Database(${JSON.stringify(path.join(dir, "studio.sqlite"))});
        raw.pragma('busy_timeout = 5000');
        await writeFile(${JSON.stringify(path.join(dir, `ready-${index}`))},'ready');
        for(;;){try{await access(${JSON.stringify(start)});break;}catch{await new Promise(r=>setTimeout(r,5));}}
        try {
          for(let i=0;i<1500;i++){
            if(${index}===0) db.updateJob(${JSON.stringify(job.id)},{progress:(i%100)/100});
            else if(${index}===1) db.recordJobStage(${JSON.stringify(job.id)},'Frames','Concurrent stage '+i);
            else raw.prepare("INSERT INTO request_limits VALUES ('fixture','contention',1,0) ON CONFLICT(workspace_id,operation) DO UPDATE SET hits=hits+1").run();
          }
        } catch(error){console.error(error.code||error.message);process.exitCode=1;}
        raw.close();
      `;
        const child = spawn(
          process.execPath,
          ["--import", "tsx", "--input-type=module", "--eval", source],
          { env: process.env, stdio: ["ignore", "ignore", "pipe"] },
        );
        children.push(child);
        let errors = "";
        child.stderr.on("data", (value) => {
          errors = (errors + value.toString()).slice(-2000);
        });
        return new Promise<{ code: number | null; errors: string }>(
          (resolve, reject) => {
            child.once("error", reject);
            child.once("close", (code) => resolve({ code, errors }));
          },
        );
      });
      const deadline = Date.now() + 15000;
      for (;;) {
        try {
          await Promise.all(
            children.map((_, i) => access(path.join(dir, `ready-${i}`))),
          );
          break;
        } catch {
          if (Date.now() > deadline)
            throw new Error(
              "Concurrent database fixtures did not become ready.",
            );
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
      }
      await writeFile(start, "start");
      for (const result of await Promise.all(results))
        assert.equal(result.code, 0, result.errors);
      assert.equal(db.getJob(job.id)!.status, "rendering");
      assert.equal(
        db.getJob(job.id)!.events!.at(-1)!.message,
        "Concurrent stage 1499",
      );
      const verify = new Database(path.join(dir, "studio.sqlite"));
      assert.equal(
        (
          verify
            .prepare(
              "SELECT hits FROM request_limits WHERE workspace_id='fixture'",
            )
            .get() as { hits: number }
        ).hits,
        1500,
      );
      verify.close();
    } finally {
      for (const child of children)
        if (child.exitCode === null && !child.signalCode) child.kill("SIGKILL");
      await rm(dir, { recursive: true, force: true });
    }
  },
);
