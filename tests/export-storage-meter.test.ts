import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  rm,
  open,
  lstat,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { beginExportMeter } from "../src/lib/export-storage-meter";
import {
  ExportStorageUnavailable,
  ExportOutputLimit,
} from "../src/lib/export-storage-policy";
const MiB = 1024 ** 2;
async function fixture(
  run: (f: { root: string; jobId: string; dir: string }) => Promise<void>,
) {
  const root = await mkdtemp(
      path.join(tmpdir(), "reelchemy-export-meter-loop-"),
    ),
    jobId = randomUUID(),
    dir = path.join(root, jobId);
  await mkdir(dir);
  try {
    await run({ root, jobId, dir });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
async function wait(read: () => boolean) {
  const deadline = Date.now() + 4000;
  while (!read()) {
    if (Date.now() > deadline)
      assert.fail("Output meter did not observe the changed synthetic files.");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
test("growing output cancels at the captured bound but reports its exact footprint and preserves bytes for reviewed cleanup", async () =>
  fixture(async (f) => {
    const meter = await beginExportMeter(f.root, f.jobId, MiB);
    try {
      const file = await open(path.join(f.dir, "video.mp4"), "w");
      await file.truncate(MiB + 1);
      await file.close();
      await wait(() => meter.cancelled);
      assert(meter.error instanceof ExportOutputLimit);
      assert.throws(() => meter.assertWithinBudget(), ExportOutputLimit);
      assert.deepEqual(await meter.stop(), { bytes: MiB + 1, files: 1 });
      assert.equal((await lstat(path.join(f.dir, "video.mp4"))).size, MiB + 1);
    } finally {
      await meter.stop();
    }
  }));
test("stopping joins pending scans and performs one stable final count instead of keeping a stale reservation", async () =>
  fixture(async (f) => {
    const meter = await beginExportMeter(f.root, f.jobId, MiB);
    await writeFile(path.join(f.dir, "report.json"), "known");
    const first = meter.stop(),
      again = meter.stop();
    assert.equal(first, again);
    assert.deepEqual(await first, { bytes: 5, files: 1 });
    assert.equal(meter.cancelled, false);
    assert.doesNotThrow(() => meter.assertWithinBudget());
    assert.equal(
      await readFile(path.join(f.dir, "report.json"), "utf8"),
      "known",
    );
  }));
test("unexpected data stops the meter and cannot be reported as reclaimed or removed", async () =>
  fixture(async (f) => {
    const meter = await beginExportMeter(f.root, f.jobId, MiB);
    try {
      await writeFile(path.join(f.dir, "operator.txt"), "KEEP");
      await wait(() => meter.cancelled);
      assert(meter.error instanceof ExportStorageUnavailable);
      await assert.rejects(meter.stop(), ExportStorageUnavailable);
      assert.equal(
        await readFile(path.join(f.dir, "operator.txt"), "utf8"),
        "KEEP",
      );
    } finally {
      await meter.stop().catch(() => {});
    }
  }));
