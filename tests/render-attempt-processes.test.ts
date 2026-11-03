import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { tmpdir } from "node:os";
import { once } from "node:events";
import {
  spawnTestProcess,
  shutdownTestProcesses,
} from "../scripts/test-process";
import {
  liveNativeRenderJobs,
  renderJobMarker,
  renderRootMarker,
} from "../src/lib/render-attempt-processes";
test("recovery detects inherited native job/root markers, ignores another studio and observes teardown without signalling it", async () => {
  const root = path.join(tmpdir(), `native-attempt-${randomUUID()}`),
    job = randomUUID(),
    other = randomUUID();
  const start = (id: string, studio: string) =>
    spawnTestProcess(
      process.execPath,
      ["-e", "process.stdout.write('ready\\n');setInterval(()=>{},1000)"],
      {
        stdio: ["ignore", "pipe", "pipe"],
        env: {
          ...process.env,
          [renderJobMarker]: id,
          [renderRootMarker]: studio,
        },
      },
    );
  const owned = start(job, root),
    foreign = start(other, root + "-foreign");
  try {
    await Promise.all([
      once(owned.stdout!, "data"),
      once(foreign.stdout!, "data"),
    ]);
    assert.deepEqual([...(await liveNativeRenderJobs(root))], [job]);
    assert.equal(foreign.exitCode, null);
    await shutdownTestProcesses([owned]);
    assert.deepEqual([...(await liveNativeRenderJobs(root))], []);
    assert.equal(foreign.exitCode, null);
    assert.deepEqual(
      [...(await liveNativeRenderJobs(root + "-foreign"))],
      [other],
    );
  } finally {
    await shutdownTestProcesses([owned, foreign]);
  }
});
