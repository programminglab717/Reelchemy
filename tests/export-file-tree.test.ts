import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  rm,
  rename,
  symlink,
  link,
  unlink,
  open,
  lstat,
} from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  inspectExportFiles,
  removeReviewedExportFiles,
  exportFilesPreview,
} from "../src/lib/export-file-tree";
import {
  ExportFileConflict,
  ExportFileUnavailable,
  maximumExportReviewBytes,
} from "../src/lib/export-file-policy";
async function fixture(
  run: (f: {
    root: string;
    dir: string;
    jobId: string;
    projectId: string;
    workspaceId: string;
  }) => Promise<void>,
) {
  const base = await mkdtemp(path.join(tmpdir(), "reelchemy-export-tree-")),
    root = path.join(base, "exports"),
    jobId = randomUUID(),
    dir = path.join(root, jobId);
  await mkdir(dir, { recursive: true });
  try {
    await run({
      root,
      dir,
      jobId,
      projectId: "owned-project",
      workspaceId: "owned-workspace",
    });
  } finally {
    await rm(base, { recursive: true, force: true });
  }
}
test("review binds bytes and removes only approved files, preserving another export", async () =>
  fixture(async (f) => {
    await writeFile(path.join(f.dir, "video.mp4"), "owned-mp4");
    await writeFile(path.join(f.dir, "report.json"), "owned-report");
    const other = path.join(f.root, randomUUID());
    await mkdir(other);
    await writeFile(path.join(other, "video.mp4"), "KEEP");
    const m = await inspectExportFiles(f.root, f),
      p = exportFilesPreview(m);
    assert.equal(p.files, 2);
    assert.equal(p.bytes, 21);
    assert.equal(p.digest.length, 64);
    assert(!JSON.stringify(p).includes("ino"));
    await removeReviewedExportFiles(f.root, m, () => false);
    await assert.rejects(lstat(f.dir), { code: "ENOENT" });
    assert.equal(await readFile(path.join(other, "video.mp4"), "utf8"), "KEEP");
    await removeReviewedExportFiles(f.root, m, () => false);
  }));
test("stale bytes and unexpected additions refuse all unlinks", async () =>
  fixture(async (f) => {
    await writeFile(path.join(f.dir, "video.mp4"), "original");
    await writeFile(path.join(f.dir, "report.json"), "report");
    const m = await inspectExportFiles(f.root, f);
    await writeFile(path.join(f.dir, "video.mp4"), "modified");
    await assert.rejects(
      removeReviewedExportFiles(f.root, m, () => false),
      ExportFileConflict,
    );
    assert.equal(
      await readFile(path.join(f.dir, "report.json"), "utf8"),
      "report",
    );
    const n = await inspectExportFiles(f.root, f);
    await writeFile(path.join(f.dir, "operator.txt"), "KEEP");
    await assert.rejects(
      removeReviewedExportFiles(f.root, n, () => false),
      ExportFileConflict,
    );
    await assert.rejects(inspectExportFiles(f.root, f), ExportFileUnavailable);
    assert.equal(
      await readFile(path.join(f.dir, "operator.txt"), "utf8"),
      "KEEP",
    );
  }));
test("review refuses symlinks at root/job/file, FIFOs and directories without blocking or following", async () =>
  fixture(async (f) => {
    const outside = path.join(f.root, "outside");
    await mkdir(outside);
    await writeFile(path.join(outside, "video.mp4"), "CANARY");
    const alias = path.join(f.root, "alias");
    await symlink(outside, alias);
    await assert.rejects(inspectExportFiles(alias, f), ExportFileUnavailable);
    await rename(f.dir, f.dir + "-original");
    await symlink(outside, f.dir);
    await assert.rejects(inspectExportFiles(f.root, f), ExportFileUnavailable);
    await unlink(f.dir);
    await rename(f.dir + "-original", f.dir);
    await symlink(
      path.join(outside, "video.mp4"),
      path.join(f.dir, "video.mp4"),
    );
    await assert.rejects(inspectExportFiles(f.root, f), ExportFileUnavailable);
    await unlink(path.join(f.dir, "video.mp4"));
    execFileSync("mkfifo", [path.join(f.dir, "video.mp4")]);
    await assert.rejects(inspectExportFiles(f.root, f), ExportFileUnavailable);
    await unlink(path.join(f.dir, "video.mp4"));
    await mkdir(path.join(f.dir, "video.mp4"));
    await assert.rejects(inspectExportFiles(f.root, f), ExportFileUnavailable);
    assert.equal(
      await readFile(path.join(outside, "video.mp4"), "utf8"),
      "CANARY",
    );
  }));
test("directory substitution, abort, stopping and oversized sparse files preserve canaries", async () =>
  fixture(async (f) => {
    await writeFile(path.join(f.dir, "video.mp4"), "ORIGINAL");
    const m = await inspectExportFiles(f.root, f);
    await assert.rejects(
      inspectExportFiles(f.root, f, AbortSignal.abort()),
      ExportFileUnavailable,
    );
    await assert.rejects(
      removeReviewedExportFiles(f.root, m, () => true),
      ExportFileUnavailable,
    );
    await rename(f.dir, f.dir + "-original");
    await mkdir(f.dir);
    await writeFile(path.join(f.dir, "video.mp4"), "REPLACEMENT");
    await assert.rejects(
      removeReviewedExportFiles(f.root, m, () => false),
      ExportFileConflict,
    );
    assert.equal(
      await readFile(path.join(f.dir, "video.mp4"), "utf8"),
      "REPLACEMENT",
    );
    const file = await open(path.join(f.dir, "video.mp4"), "w");
    await file.truncate(maximumExportReviewBytes + 1);
    await file.close();
    await assert.rejects(inspectExportFiles(f.root, f), ExportFileUnavailable);
  }));
test("partial retries tolerate own missing files and hardlink ctime changes without damaging external sources", async () =>
  fixture(async (f) => {
    const source = path.join(f.root, "source");
    await writeFile(source, "KEEP");
    await link(source, path.join(f.dir, "video.mp4"));
    await link(source, path.join(f.dir, "thumbnail.png"));
    await writeFile(path.join(f.dir, "report.json"), "first");
    const m = await inspectExportFiles(f.root, f);
    await unlink(path.join(f.dir, "report.json"));
    await removeReviewedExportFiles(f.root, m, () => false);
    assert.equal(await readFile(source, "utf8"), "KEEP");
    await assert.rejects(lstat(f.dir), { code: "ENOENT" });
  }));
