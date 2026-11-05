import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  rm,
  symlink,
  link,
  unlink,
  open,
  lstat,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { measureExportFiles } from "../src/lib/export-storage-files";
import { ExportStorageUnavailable } from "../src/lib/export-storage-policy";
async function fixture(
  run: (f: { root: string; jobId: string; dir: string }) => Promise<void>,
) {
  const root = await mkdtemp(path.join(tmpdir(), "reelchemy-export-meter-")),
    jobId = randomUUID(),
    dir = path.join(root, jobId);
  try {
    await run({ root, jobId, dir });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
test("metadata census counts exact logical payload sizes including hardlinks without reading or changing bytes", async () =>
  fixture(async (f) => {
    await mkdir(f.dir);
    await writeFile(path.join(f.dir, "video.mp4"), "KEEP");
    await link(
      path.join(f.dir, "video.mp4"),
      path.join(f.dir, "thumbnail.png"),
    );
    await writeFile(path.join(f.dir, "report.json"), "report");
    const before = await lstat(path.join(f.dir, "video.mp4"), { bigint: true });
    assert.deepEqual(await measureExportFiles(f.root, f.jobId), {
      bytes: 14,
      files: 3,
    });
    assert.equal(await readFile(path.join(f.dir, "video.mp4"), "utf8"), "KEEP");
    const after = await lstat(path.join(f.dir, "video.mp4"), { bigint: true });
    assert.equal(before.ino, after.ino);
    assert.equal(before.mtimeNs, after.mtimeNs);
  }));
test("missing output has no files and cancellation or invalid identifiers cannot adopt paths", async () =>
  fixture(async (f) => {
    assert.deepEqual(await measureExportFiles(f.root, f.jobId), {
      bytes: 0,
      files: 0,
    });
    await assert.rejects(
      measureExportFiles(f.root, "../escape"),
      ExportStorageUnavailable,
    );
    await assert.rejects(
      measureExportFiles(f.root, f.jobId, { isStopping: () => true }),
      ExportStorageUnavailable,
    );
    await assert.rejects(lstat(f.dir), { code: "ENOENT" });
  }));
test("unknown files and root/job/file symlinks preserve their external target and refuse measurement", async () =>
  fixture(async (f) => {
    await mkdir(f.dir);
    const outside = path.join(f.root, "outside");
    await mkdir(outside);
    await writeFile(path.join(outside, "video.mp4"), "CANARY");
    await symlink(outside, path.join(f.root, "alias"));
    await assert.rejects(
      measureExportFiles(path.join(f.root, "alias"), f.jobId),
      ExportStorageUnavailable,
    );
    await symlink(
      path.join(outside, "video.mp4"),
      path.join(f.dir, "video.mp4"),
    );
    await assert.rejects(
      measureExportFiles(f.root, f.jobId),
      ExportStorageUnavailable,
    );
    await unlink(path.join(f.dir, "video.mp4"));
    await writeFile(path.join(f.dir, "operator.txt"), "KEEP");
    await assert.rejects(
      measureExportFiles(f.root, f.jobId),
      ExportStorageUnavailable,
    );
    assert.equal(
      await readFile(path.join(outside, "video.mp4"), "utf8"),
      "CANARY",
    );
    assert.equal(
      await readFile(path.join(f.dir, "operator.txt"), "utf8"),
      "KEEP",
    );
  }));
test("large sparse exports are measured by metadata without hashing their logical gigabytes", async () =>
  fixture(async (f) => {
    await mkdir(f.dir);
    const file = await open(path.join(f.dir, "video.mp4"), "w");
    await file.truncate(2 * 1024 ** 3);
    await file.close();
    assert.deepEqual(await measureExportFiles(f.root, f.jobId), {
      bytes: 2 * 1024 ** 3,
      files: 1,
    });
    assert.deepEqual(
      await measureExportFiles(f.root, f.jobId, { working: true }),
      { bytes: 2 * 1024 ** 3, files: 1 },
    );
  }));

test("encoded verification files remain metered through frame promotion and failed-output cleanup", async () =>
  fixture(async (f) => {
    await mkdir(f.dir);
    await writeFile(path.join(f.dir, "encoded-frame-0001.png"), "PENDING");
    await writeFile(path.join(f.dir, "verification-tail.png"), "TAIL");
    await writeFile(path.join(f.dir, "layout-60-before.png"), "LAYOUT");
    for (const working of [true, false])
      assert.deepEqual(await measureExportFiles(f.root, f.jobId, { working }), {
        bytes: 17,
        files: 3,
      });
    const { inspectExportFiles, removeReviewedExportFiles } =
      await import("../src/lib/export-file-tree");
    const reviewed = await inspectExportFiles(f.root, {
      jobId: f.jobId,
      projectId: "project",
      workspaceId: "studio",
    });
    assert.equal(reviewed.files.length, 3);
    await removeReviewedExportFiles(f.root, reviewed, () => false);
    await assert.rejects(lstat(f.dir), { code: "ENOENT" });
  }));
