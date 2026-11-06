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
  releaseNativeRenderJob,
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
      "import ctypes,time; libc=ctypes.CDLL(None); assert libc.prctl(15,b'chrome',0,0,0)==0; assert libc.prctl(4,0,0,0,0)==0; print('ready',flush=True); time.sleep(30)",
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

test("an unrelated non-dumpable same-UID program does not block recovery, while browser-named ones still do", async () => {
  const root = path.join(tmpdir(), `unrelated-native-${randomUUID()}`);
  const child = spawnTestProcess(
    "python3",
    [
      "-c",
      "import ctypes,time; libc=ctypes.CDLL(None); assert libc.prctl(15,b'ssh-agent',0,0,0)==0; assert libc.prctl(4,0,0,0,0)==0; print('ready',flush=True); time.sleep(30)",
    ],
    { stdio: ["ignore", "pipe", "pipe"], env: { ...process.env } },
  );
  try {
    await once(child.stdout!, "data");
    const name = (await readFile(`/proc/${child.pid}/stat`, "utf8")).match(
      /\(([^)]*)\)/,
    )?.[1];
    assert.equal(name, "ssh-agent");
    assert.deepEqual([...(await liveNativeRenderJobs(root))], []);
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

test("attempt release escalates to SIGKILL for this consumer's own blocked marked child but never signals a marked process it did not start", async () => {
  const root = path.join(tmpdir(), `release-native-${randomUUID()}`),
    job = randomUUID();
  const env = {
    ...process.env,
    [renderJobMarker]: job,
    [renderRootMarker]: root,
  };
  // Detached grandchild: reparented away from this process, still marked.
  const launcher = spawnTestProcess(
    "python3",
    [
      "-c",
      "import os,signal,time\nif os.fork()==0:\n os.setsid()\n if os.fork()==0:\n  signal.signal(signal.SIGTERM, signal.SIG_IGN); print(os.getpid(),flush=True); time.sleep(60)\n os._exit(0)\nos.wait()",
    ],
    { stdio: ["ignore", "pipe", "pipe"], env },
  );
  const [bytes] = await once(launcher.stdout!, "data"),
    orphan = Number(bytes.toString().trim());
  assert(Number.isSafeInteger(orphan) && orphan > 1);
  const owned = spawnTestProcess(
    "python3",
    [
      "-c",
      "import signal,time; signal.signal(signal.SIGTERM, signal.SIG_IGN); print('ready',flush=True); time.sleep(60)",
    ],
    { stdio: ["ignore", "pipe", "pipe"], env },
  );
  try {
    await once(owned.stdout!, "data");
    // The detached grandchild keeps the pipe open; wait for process exit only.
    if (launcher.exitCode === null && !launcher.signalCode)
      await once(launcher, "exit");
    assert.deepEqual([...(await liveNativeRenderJobs(root))], [job]);
    const begun = Date.now();
    assert.equal(
      await releaseNativeRenderJob(root, job, { graceMs: 200, signalMs: 1500 }),
      false,
    );
    assert(Date.now() - begun < 10000);
    // The owned child ignored SIGTERM and was killed; the foreign one remains.
    assert.notEqual(owned.exitCode ?? owned.signalCode, null);
    assert.equal(owned.signalCode, "SIGKILL");
    process.kill(orphan, 0);
    assert.deepEqual([...(await liveNativeRenderJobs(root))], [job]);
  } finally {
    try {
      process.kill(orphan, "SIGKILL");
    } catch {}
    await shutdownTestProcesses([owned, launcher]);
  }
  const end = Date.now() + 5000;
  while ((await liveNativeRenderJobs(root)).size && Date.now() < end)
    await new Promise((resolve) => setTimeout(resolve, 50));
  assert.deepEqual([...(await liveNativeRenderJobs(root))], []);
  assert.equal(await releaseNativeRenderJob(root, job), true);
});
