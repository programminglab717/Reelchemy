import { test } from "node:test";
import assert from "node:assert/strict";
import {
  runCommand,
  CommandCancelledError,
  CommandTimeoutError,
} from "../src/lib/process";
import { transientRenderError } from "../src/lib/retry";
import { RenderQCError } from "../src/lib/layout-qc";
test("media subprocess cancellation, timeout and output caps terminate actual children", async () => {
  const ok = await runCommand(process.execPath, [
    "-e",
    'process.stdout.write("ok")',
  ]);
  assert.equal(ok.stdout, "ok");
  await assert.rejects(
    () =>
      runCommand(process.execPath, ["-e", "setInterval(()=>{},1000)"], {
        timeoutMs: 50,
      }),
    CommandTimeoutError,
  );
  let cancelled = false;
  const timer = setTimeout(() => {
    cancelled = true;
  }, 60);
  await assert.rejects(
    () =>
      runCommand(process.execPath, ["-e", "setInterval(()=>{},1000)"], {
        cancelled: () => cancelled,
      }),
    CommandCancelledError,
  );
  clearTimeout(timer);
  await assert.rejects(
    () =>
      runCommand(
        process.execPath,
        ["-e", 'process.stdout.write("x".repeat(10000))'],
        { maxOutputBytes: 100 },
      ),
    /output exceeded/,
  );
  assert(transientRenderError(new Error("Target closed")));
  assert(!transientRenderError(new RenderQCError([])));
  assert(!transientRenderError(new CommandCancelledError()));
  assert(!transientRenderError(new Error("Missing asset")));
});
