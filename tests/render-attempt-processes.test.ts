import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { tmpdir } from "node:os";
import { once } from "node:events";
import { readFile } from "node:fs/promises";
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

test("a same-UID non-dumpable native child cannot disappear from recovery through proc directory ownership", async () => {
  const root = path.join(tmpdir(), `private-native-${randomUUID()}`),
    job = randomUUID();
  const child = spawnTestProcess(
    "python3",
    [
      "-c",
      "import ctypes,time; assert ctypes.CDLL(None).prctl(4,0,0,0,0)==0; print('ready',flush=True); time.sleep(30)",
    ],
    {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, [renderJobMarker]: job, [renderRootMarker]: root },
    },
  );
  try {
    await once(child.stdout!, "data");
    await assert.rejects(liveNativeRenderJobs(root), /cannot be verified/);
  } finally {
    child.kill("SIGTERM");
    await shutdownTestProcesses([child]);
  }
});

test("an unreaped non-dumpable zombie cannot block recovery because it has stopped executing", async () => {
  const parent = spawnTestProcess(
    "python3",
    [
      "-c",
      "import os,ctypes,time; p=os.fork();\nif p==0:\n ctypes.CDLL(None).prctl(4,0,0,0,0); os._exit(0)\nprint(p,flush=True); time.sleep(30)",
    ],
    { stdio: ["ignore", "pipe", "pipe"], env: { ...process.env } },
  );
  try {
    const [bytes] = await once(parent.stdout!, "data"),
      pid = Number(bytes.toString().trim());
    assert(Number.isSafeInteger(pid) && pid > 1);
    const deadline = Date.now() + 4000;
    let state = "";
    while (state !== "Z") {
      const stat = await readFile(`/proc/${pid}/stat`, "utf8");
      state = stat.slice(stat.lastIndexOf(")") + 2).split(" ")[0];
      if (Date.now() > deadline)
        assert.fail("Synthetic child did not reach its unreaped state.");
      if (state !== "Z")
        await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.deepEqual(
      [
        ...(await liveNativeRenderJobs(
          path.join(tmpdir(), `zombie-studio-${randomUUID()}`),
        )),
      ],
      [],
    );
  } finally {
    await shutdownTestProcesses([parent]);
  }
});
