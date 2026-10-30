import { test } from "node:test";
import assert from "node:assert/strict";
import { ChildProcess } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { once } from "node:events";
import {
  spawnTestProcess,
  signalTestProcess,
  shutdownTestProcesses,
} from "../scripts/test-process";

test(
  "test shutdown owns detached descendants even after launcher exit and preserves unrelated test processes",
  { timeout: 10000 },
  async () => {
    const dir = await mkdtemp(
      path.join(tmpdir(), "reelchemy-process-ownership-"),
    );
    const ready = path.join(dir, "descendant"),
      sentinelReady = path.join(dir, "sentinel");
    const descendantCode = `const fs=require('node:fs');process.on('SIGTERM',()=>{});fs.writeFileSync(process.argv[1],String(process.pid));setInterval(()=>{},1000);`;
    const program = `const{spawn}=require('node:child_process');const c=spawn(process.execPath,['-e',${JSON.stringify(descendantCode)},process.argv[1]],{detached:true,stdio:'ignore',env:process.env});c.unref();`;
    const parent = spawnTestProcess(process.execPath, ["-e", program, ready], {
      stdio: "ignore",
      env: process.env,
    });
    const ended = once(parent, "close");
    const sentinel = spawnTestProcess(
      process.execPath,
      ["-e", descendantCode, sentinelReady],
      { stdio: "ignore", env: process.env },
    );
    try {
      await ended;
      async function pid(file: string) {
        const deadline = Date.now() + 3000;
        while (Date.now() < deadline) {
          try {
            return Number(await readFile(file, "utf8"));
          } catch {}
          await new Promise((resolve) => setTimeout(resolve, 25));
        }
        throw new Error("Synthetic child did not start");
      }
      const descendant = await pid(ready),
        unrelated = await pid(sentinelReady);
      process.kill(descendant, 0);
      await shutdownTestProcesses([parent], 100);
      const status = await readFile(`/proc/${descendant}/status`, "utf8").catch(
        () => "",
      );
      assert(
        !status || /^State:\s*Z/m.test(status),
        "detached descendant must no longer execute",
      );
      process.kill(unrelated, 0);
      assert.throws(
        () => signalTestProcess(new ChildProcess(), "SIGTERM"),
        /unowned/,
      );
    } finally {
      await shutdownTestProcesses([parent, sentinel], 100);
      await rm(dir, { recursive: true, force: true });
    }
  },
);
