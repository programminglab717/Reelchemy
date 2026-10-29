import { test } from "node:test";
import assert from "node:assert/strict";
import {
  limitsPolicy,
  LimitConfigurationError,
  RequestRateError,
} from "../src/lib/limits-policy";
import { failure } from "../src/lib/http";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { execFileSync, spawn } from "node:child_process";
const dir = await mkdtemp(path.join(tmpdir(), "reelchemy-request-limits-"));
process.env.REELCHEMY_DATA_DIR = dir;
process.env.REELCHEMY_ARTIFACT_DIR = path.join(dir, "artifacts");
const { takeRequestLimit } = await import("../src/lib/db");

test("public request policies are bounded and bad operator settings fail closed", async () => {
  assert.equal(limitsPolicy({}).writes.count, 120);
  assert.equal(
    limitsPolicy({ REELCHEMY_PLANS_PER_DAY: "25" }).planning.count,
    25,
  );
  for (const value of ["-1", "0", "NaN", "1.5", "Infinity", "999999999999999"])
    assert.throws(
      () => limitsPolicy({ REELCHEMY_WRITES_PER_MINUTE: value }),
      LimitConfigurationError,
    );
  const limited = failure(new RequestRateError(90, "media"));
  assert.equal(limited.status, 429);
  assert.equal(limited.headers.get("retry-after"), "90");
  assert.equal((await limited.json()).code, "RATE_LIMITED");
  assert.equal(failure(new LimitConfigurationError()).status, 503);
});
test("request limits isolate workspaces/operations, retain counters on restart and reset after their window", () => {
  assert(takeRequestLimit("creator-a", "writes", 2, 60000, 1000).allowed);
  assert(takeRequestLimit("creator-a", "writes", 2, 60000, 2000).allowed);
  assert.deepEqual(takeRequestLimit("creator-a", "writes", 2, 60000, 2001), {
    allowed: false,
    retryAfter: 59,
  });
  assert(takeRequestLimit("creator-b", "writes", 2, 60000, 2001).allowed);
  assert(takeRequestLimit("creator-a", "media", 2, 60000, 2001).allowed);
  const result = execFileSync(
    process.execPath,
    [
      "--import",
      "tsx",
      "--input-type=module",
      "-e",
      "const {takeRequestLimit}=await import('./src/lib/db.ts');console.log(JSON.stringify(takeRequestLimit('creator-a','writes',2,60000,3000)))",
    ],
    { encoding: "utf8", env: process.env },
  );
  assert.deepEqual(JSON.parse(result), { allowed: false, retryAfter: 58 });
  assert(takeRequestLimit("creator-a", "writes", 2, 60000, 61000).allowed);
});
test("parallel processes cannot over-admit a shared request budget", async () => {
  const results = await Promise.all(
    Array.from(
      { length: 3 },
      () =>
        new Promise<number>((resolve, reject) => {
          const child = spawn(
            process.execPath,
            [
              "--import",
              "tsx",
              "--input-type=module",
              "-e",
              "const {takeRequestLimit}=await import('./src/lib/db.ts');let n=0;for(let i=0;i<5;i++) if(takeRequestLimit('shared','writes',3,60000,1000).allowed)n++;console.log(n)",
            ],
            { env: process.env, stdio: ["ignore", "pipe", "pipe"] },
          );
          let output = "",
            error = "";
          child.stdout.on("data", (b) => {
            output += b.toString();
          });
          child.stderr.on("data", (b) => {
            error += b.toString();
          });
          child.once("error", reject);
          child.once("close", (code) =>
            code === 0
              ? resolve(Number(output.trim()))
              : reject(new Error(error)),
          );
        }),
    ),
  );
  assert.equal(
    results.reduce((n, value) => n + value, 0),
    3,
  );
  await rm(dir, { recursive: true, force: true });
});
