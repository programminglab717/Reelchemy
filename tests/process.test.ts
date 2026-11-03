import { test } from "node:test";
import assert from "node:assert/strict";
import {
  runCommand,
  CommandCancelledError,
  CommandTimeoutError,
} from "../src/lib/process";
import { transientRenderError } from "../src/lib/retry";
import { RenderBrowserCleanupError } from "../src/lib/render-browser-process";
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
  assert(
    transientRenderError(
      new Error(
        "Timed out after 25000 ms while trying to connect to the browser! Chrome logged the following: synthetic startup output",
      ),
    ),
  );
  assert(
    !transientRenderError(
      new Error("Timed out after 25000 ms while loading an invalid asset"),
    ),
  );
  assert(
    !transientRenderError(
      new Error("Failed to launch the browser process! Missing executable"),
    ),
  );
  assert(!transientRenderError(new RenderBrowserCleanupError()));
  assert(!transientRenderError(new RenderQCError([])));
  assert(!transientRenderError(new CommandCancelledError()));
  assert(!transientRenderError(new Error("Missing asset")));
});
