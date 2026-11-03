import { constants, type BigIntStats } from "node:fs";
import {
  open,
  readdir,
  lstat,
  unlink,
  rmdir,
  type FileHandle,
} from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import {
  exportFileManifest,
  ExportFileConflict,
  ExportFileUnavailable,
  validExportFilename,
  maximumExportReviewBytes,
  type ExportFileManifest,
  type ExportFilePreview,
} from "./export-file-policy";
const id = (s: BigIntStats) => ({
  dev: s.dev.toString(),
  ino: s.ino.toString(),
});
const same = (
  a: { dev: string; ino: string },
  b: { dev: string; ino: string },
) => a.dev === b.dev && a.ino === b.ino;
const anchor = (h: FileHandle) => `/proc/${process.pid}/fd/${h.fd}`;
async function rootDirectory(root: string) {
  let handle: FileHandle | undefined;
  try {
    handle = await open(
      "/",
      constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
    );
    for (const name of path.resolve(root).split(path.sep).filter(Boolean)) {
      const next = await open(
        path.join(anchor(handle), name),
        constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
      );
      const previous = handle;
      handle = next;
      await previous.close();
    }
    return handle;
  } catch (error) {
    await handle?.close();
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw new ExportFileUnavailable();
  }
}
async function childDirectory(root: FileHandle, jobId: string) {
  try {
    return await open(
      path.join(anchor(root), jobId),
      constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw new ExportFileUnavailable();
  }
}
async function regular(root: FileHandle, name: string) {
  const handle = await open(
    path.join(anchor(root), name),
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  );
  try {
    const metadata = await handle.stat({ bigint: true });
    if (!metadata.isFile() || metadata.size > BigInt(maximumExportReviewBytes))
      throw new ExportFileUnavailable();
    return { handle, metadata };
  } catch (error) {
    await handle.close();
    throw error;
  }
}
async function checksum(
  handle: FileHandle,
  initial: BigIntStats,
  check: () => void,
) {
  const bytes = Buffer.allocUnsafe(65536),
    hash = createHash("sha256");
  let position = 0;
  while (position < Number(initial.size)) {
    check();
    const { bytesRead } = await handle.read(
      bytes,
      0,
      Math.min(bytes.length, Number(initial.size) - position),
      position,
    );
    if (!bytesRead) throw new ExportFileConflict();
    hash.update(bytes.subarray(0, bytesRead));
    position += bytesRead;
  }
  const current = await handle.stat({ bigint: true });
  if (
    current.size !== initial.size ||
    current.mtimeNs !== initial.mtimeNs ||
    current.ctimeNs !== initial.ctimeNs
  )
    throw new ExportFileConflict();
  return hash.digest("hex");
}
export const exportFilesDigest = (m: ExportFileManifest) =>
  createHash("sha256")
    .update("reelchemy-export-files-v1\0")
    .update(JSON.stringify(m))
    .digest("hex");
export function exportFilesPreview(m: ExportFileManifest): ExportFilePreview {
  return {
    jobId: m.jobId,
    projectId: m.projectId,
    digest: exportFilesDigest(m),
    files: m.files.length,
    bytes: m.files.reduce((n, f) => n + f.bytes, 0),
  };
}
export async function inspectExportFiles(
  root: string,
  input: Pick<ExportFileManifest, "jobId" | "projectId" | "workspaceId">,
  signal?: AbortSignal,
) {
  input = {
    jobId: input.jobId,
    projectId: input.projectId,
    workspaceId: input.workspaceId,
  };
  exportFileManifest.parse({
    format: "reelchemy-export-files-v1",
    ...input,
    root: null,
    directory: null,
    files: [],
  });
  const deadline = Date.now() + 15000;
  const check = () => {
    if (signal?.aborted || Date.now() > deadline)
      throw new ExportFileUnavailable();
  };
  let parent: FileHandle | undefined, directory: FileHandle | undefined;
  try {
    check();
    parent = await rootDirectory(root);
    const manifest: ExportFileManifest = {
      format: "reelchemy-export-files-v1",
      ...input,
      root: parent ? id(await parent.stat({ bigint: true })) : null,
      directory: null,
      files: [],
    };
    if (!parent) return manifest;
    directory = await childDirectory(parent, input.jobId);
    if (!directory) return manifest;
    manifest.directory = id(await directory.stat({ bigint: true }));
    const names = (await readdir(anchor(directory))).sort();
    if (names.length > 2048 || names.some((n) => !validExportFilename(n)))
      throw new ExportFileUnavailable();
    let total = 0;
    for (const name of names) {
      check();
      const meta = await lstat(path.join(anchor(directory), name), {
        bigint: true,
      });
      if (!meta.isFile() || meta.size > BigInt(maximumExportReviewBytes))
        throw new ExportFileUnavailable();
      total += Number(meta.size);
      if (total > maximumExportReviewBytes) throw new ExportFileUnavailable();
    }
    total = 0;
    for (const name of names) {
      check();
      const file = await regular(directory, name);
      try {
        total += Number(file.metadata.size);
        if (total > maximumExportReviewBytes) throw new ExportFileUnavailable();
        const sha256 = await checksum(file.handle, file.metadata, check);
        manifest.files.push({
          name,
          ...id(file.metadata),
          bytes: Number(file.metadata.size),
          mtime: file.metadata.mtimeNs.toString(),
          ctime: file.metadata.ctimeNs.toString(),
          sha256,
        });
      } finally {
        await file.handle.close();
      }
    }
    return exportFileManifest.parse(manifest);
  } catch (error) {
    if (
      error instanceof ExportFileConflict ||
      error instanceof ExportFileUnavailable
    )
      throw error;
    throw new ExportFileUnavailable();
  } finally {
    await directory?.close();
    await parent?.close();
  }
}
// Only between jobs under the permanent consumer kernel lock, after SQL checks.
export async function removeReviewedExportFiles(
  root: string,
  input: ExportFileManifest,
  isStopping: () => boolean,
) {
  const manifest = exportFileManifest.parse(input),
    deadline = Date.now() + 30000;
  let parent: FileHandle | undefined, directory: FileHandle | undefined;
  const check = () => {
    if (isStopping() || Date.now() > deadline)
      throw new ExportFileUnavailable();
  };
  try {
    check();
    parent = await rootDirectory(root);
    if (!parent) return;
    directory = await childDirectory(parent, manifest.jobId);
    if (!directory) return;
    if (
      !manifest.root ||
      !manifest.directory ||
      !same(id(await parent.stat({ bigint: true })), manifest.root) ||
      !same(id(await directory.stat({ bigint: true })), manifest.directory)
    )
      throw new ExportFileConflict();
    const allowed = new Map(manifest.files.map((f) => [f.name, f])),
      names = (await readdir(anchor(directory))).sort();
    if (names.some((n) => !allowed.has(n))) throw new ExportFileConflict();
    const verified = new Map<string, BigIntStats>();
    for (const name of names) {
      check();
      const expected = allowed.get(name)!,
        file = await regular(directory, name);
      try {
        if (
          !same(id(file.metadata), expected) ||
          Number(file.metadata.size) !== expected.bytes ||
          file.metadata.mtimeNs.toString() !== expected.mtime ||
          (await checksum(file.handle, file.metadata, check)) !==
            expected.sha256
        )
          throw new ExportFileConflict();
        verified.set(name, file.metadata);
      } finally {
        await file.handle.close();
      }
    }
    const inodeTimes = new Map<string, string>();
    for (const name of names) {
      check();
      const expected = allowed.get(name)!,
        previous = verified.get(name)!,
        file = await regular(directory, name);
      try {
        const inode = `${expected.dev}:${expected.ino}`,
          expectedTime = inodeTimes.get(inode) ?? previous.ctimeNs.toString();
        if (
          !same(id(file.metadata), expected) ||
          Number(file.metadata.size) !== expected.bytes ||
          file.metadata.mtimeNs.toString() !== expected.mtime ||
          file.metadata.ctimeNs.toString() !== expectedTime
        )
          throw new ExportFileConflict();
        const pointer = await lstat(path.join(anchor(directory), name), {
          bigint: true,
        });
        if (
          !pointer.isFile() ||
          pointer.dev !== file.metadata.dev ||
          pointer.ino !== file.metadata.ino ||
          pointer.ctimeNs !== file.metadata.ctimeNs
        )
          throw new ExportFileConflict();
        await unlink(path.join(anchor(directory), name));
        inodeTimes.set(
          inode,
          (await file.handle.stat({ bigint: true })).ctimeNs.toString(),
        );
      } finally {
        await file.handle.close();
      }
    }
    check();
    if ((await readdir(anchor(directory))).length)
      throw new ExportFileConflict();
    const pointer = await lstat(path.join(anchor(parent), manifest.jobId), {
      bigint: true,
    });
    if (!pointer.isDirectory() || !same(id(pointer), manifest.directory))
      throw new ExportFileConflict();
    await rmdir(path.join(anchor(parent), manifest.jobId));
  } catch (error) {
    if (
      error instanceof ExportFileConflict ||
      error instanceof ExportFileUnavailable
    )
      throw error;
    throw new ExportFileUnavailable();
  } finally {
    await directory?.close();
    await parent?.close();
  }
}
