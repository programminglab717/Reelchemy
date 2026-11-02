import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, access, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { storageFixture } from "./project-storage-fixture";
import {
  spawnTestProcess,
  shutdownTestProcesses,
} from "../scripts/test-process";
test(
  "independent simultaneous SQLite writers cannot exceed either a studio or the shared retained-data budget",
  { timeout: 30000 },
  async () => {
    const root = await mkdtemp(
      path.join(tmpdir(), "reelchemy-project-storage-race-"),
    );
    const children: ReturnType<typeof spawnTestProcess>[] = [];
    try {
      for (const scope of ["studio", "service"]) {
        const file = path.join(root, `${scope}.sqlite`),
          db = storageFixture(file);
        db.close();
        const go = path.join(root, `${scope}.go`);
        const script = `import {existsSync,writeFileSync} from 'node:fs';
        const helperModule=await import(${JSON.stringify(pathToFileURL(path.resolve("tests/project-storage-fixture.ts")).href)});
        const helper=helperModule.default||helperModule;
        const policyModule=await import(${JSON.stringify(pathToFileURL(path.resolve("src/lib/project-storage-policy.ts")).href)});
        const policySource=policyModule.default||policyModule;
        const db=helper.storageFixture(process.env.PRIVATE_RACE_DB);
        writeFileSync(process.env.PRIVATE_RACE_READY,'ready');
        const deadline=Date.now()+15000;while(!existsSync(process.env.PRIVATE_RACE_GO)){if(Date.now()>deadline)throw new Error('Private writer barrier timed out');await new Promise(resolve=>setTimeout(resolve,10));}
        const policy={...policySource.projectStoragePolicy(),projectBytes:1048576,studioBytes:1048576,serviceBytes:process.env.PRIVATE_RACE_SCOPE==='service'?1048576:2097152};
        try{helper.writeProject(db,process.env.PRIVATE_RACE_ID,process.env.PRIVATE_RACE_OWNER,JSON.stringify({revisions:[],messages:[],padding:'x'.repeat(650000)}),policy);console.log('admitted');}
        catch(error){if(error.code!=='PROJECT_STORAGE_LIMIT')throw error;console.log('refused');}finally{db.close();}`;
        const runs = ["a", "b"].map((id) => {
          const ready = path.join(root, `${scope}.${id}.ready`);
          const child = spawnTestProcess(
            process.execPath,
            ["--import", "tsx", "--input-type=module", "--eval", script],
            {
              env: {
                ...process.env,
                PRIVATE_RACE_DB: file,
                PRIVATE_RACE_GO: go,
                PRIVATE_RACE_READY: ready,
                PRIVATE_RACE_ID: id,
                PRIVATE_RACE_OWNER: scope === "studio" ? "same-owner" : id,
                PRIVATE_RACE_SCOPE: scope,
              },
              stdio: ["ignore", "pipe", "pipe"],
            },
          );
          children.push(child);
          let output = "",
            errors = "";
          child.stdout!.on("data", (bytes) => (output += bytes.toString()));
          child.stderr!.on("data", (bytes) => (errors += bytes.toString()));
          const done = new Promise<string>((resolve, reject) => {
            child.once("error", reject);
            child.once("close", (code) =>
              code === 0
                ? resolve(output.trim())
                : reject(new Error(errors || "Private writer failed")),
            );
          });
          return { ready, done };
        });
        const deadline = Date.now() + 15000;
        while (true) {
          const ready = await Promise.all(
            runs.map((run) =>
              access(run.ready).then(
                () => true,
                () => false,
              ),
            ),
          );
          if (ready.every(Boolean)) break;
          if (Date.now() > deadline)
            throw new Error("Private writer readiness timed out");
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
        await writeFile(go, "go");
        assert.deepEqual(
          (await Promise.all(runs.map((run) => run.done))).sort(),
          ["admitted", "refused"],
        );
        const inspect = storageFixture(file);
        try {
          const row = inspect
            .prepare(
              "SELECT count(*) AS projects,sum(bytes) AS bytes FROM project_data_sizes",
            )
            .get() as { projects: number; bytes: number };
          assert.equal(row.projects, 1);
          assert(row.bytes <= 1024 ** 2);
        } finally {
          inspect.close();
        }
      }
    } finally {
      await shutdownTestProcesses(children);
      await rm(root, { recursive: true, force: true });
    }
  },
);
