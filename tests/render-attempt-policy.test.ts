import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, access, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import {
  renderAttemptPolicy,
  RenderAttemptPolicyUnavailable,
} from "../src/lib/render-attempt-policy";

test("automatic attempt budgets fit the advertised film range without changing the existing fifteen-minute ceiling", () => {
  const budget = renderAttemptPolicy("");
  for (const seconds of [1, 5, 45, 60, 180, 200])
    assert.equal(budget(seconds * 30), 600000);
  assert.equal(budget(6001), 600100);
  assert.equal(budget(300 * 30), 900000);
  assert.equal(renderAttemptPolicy("   ")(9000), 900000);
  for (const frames of [0, -1, 1.5, 9001, Number.NaN, Number.POSITIVE_INFINITY])
    assert.throws(() => budget(frames), RenderAttemptPolicyUnavailable);
});
test("explicit operator budgets remain bounded, override film defaults and are captured independently of later environment changes", () => {
  for (const [value, expected] of [
    ["1", 60000],
    ["60000", 60000],
    ["120000", 120000],
    ["600000", 600000],
    ["900000", 900000],
    ["999999", 900000],
    [" 120000 ", 120000],
  ] as const)
    for (const frames of [150, 9000])
      assert.equal(renderAttemptPolicy(value)(frames), expected);
  for (const value of [
    "0",
    "-1",
    "1.5",
    "Infinity",
    "NaN",
    "1e6",
    "900000x",
    "9007199254740992",
  ])
    assert.throws(
      () => renderAttemptPolicy(value),
      (error) =>
        error instanceof RenderAttemptPolicyUnavailable &&
        !error.message.includes(value),
    );
  const old = process.env.RENDER_JOB_TIMEOUT_MS;
  try {
    process.env.RENDER_JOB_TIMEOUT_MS = "120000";
    const captured = renderAttemptPolicy();
    process.env.RENDER_JOB_TIMEOUT_MS = "900000";
    assert.equal(captured(9000), 120000);
  } finally {
    if (old === undefined) delete process.env.RENDER_JOB_TIMEOUT_MS;
    else process.env.RENDER_JOB_TIMEOUT_MS = old;
  }
});
test("invalid real consumer startup refuses before creating a data directory or permanent lifecycle inode and does not print the configured value", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "reelchemy-budget-refusal-")),
    data = path.join(root, "must-not-initialize");
  try {
    const secret = "invalid-private-budget-canary";
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      NODE_ENV: "production",
      REELCHEMY_DATA_DIR: data,
      RENDER_JOB_TIMEOUT_MS: secret,
    };
    const result = await new Promise<{ code: number | null; output: string }>(
      (resolve, reject) => {
        const child = spawn(
          process.execPath,
          [
            "--import",
            import.meta.resolve("tsx"),
            path.resolve("scripts/worker-entrypoint.ts"),
          ],
          { env, stdio: ["ignore", "pipe", "pipe"] },
        );
        let output = "";
        child.stdout.on("data", (b) => (output += b.toString()));
        child.stderr.on("data", (b) => (output += b.toString()));
        child.once("error", reject);
        child.once("close", (code) => resolve({ code, output }));
      },
    );
    assert.notEqual(result.code, 0);
    assert.match(result.output, /Render attempt settings unavailable/);
    assert(!result.output.includes(secret));
    await assert.rejects(
      () => access(data),
      (error) => (error as NodeJS.ErrnoException).code === "ENOENT",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
