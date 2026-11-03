import { constants, type BigIntStats } from "node:fs";
import { open, readdir, lstat, type FileHandle } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { validExportFilename } from "./export-file-policy";
import { ExportStorageUnavailable } from "./export-storage-policy";
const anchor = (handle: FileHandle) => `/proc/${process.pid}/fd/${handle.fd}`;
const identity = (stat: BigIntStats) => `${stat.dev}:${stat.ino}`;
const stamp = (stat: BigIntStats) =>
  `${identity(stat)}:${stat.size}:${stat.mtimeNs}:${stat.ctimeNs}`;
async function directory(root: string) {
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
    throw error;
  }
}
// Metadata only: this never reads payload bytes, creates directories or removes
// files. A stable census runs with writers stopped; working meters tolerate
// expected disappearance during a native rename and conservatively count sizes.
export async function measureExportFiles(
  root: string,
  jobId: string,
  options: {
    working?: boolean;
    requireVideo?: boolean;
    isStopping?: () => boolean;
  } = {},
) {
  if (!z.uuid().safeParse(jobId).success) throw new ExportStorageUnavailable();
  const deadline = Date.now() + 5000,
    check = () => {
      if (Date.now() > deadline || options.isStopping?.())
        throw new ExportStorageUnavailable();
    };
  let parent: FileHandle | undefined, child: FileHandle | undefined;
  try {
    check();
    parent = await directory(root);
    if (!parent) {
      if (options.requireVideo) throw new ExportStorageUnavailable();
      return { bytes: 0, files: 0 };
    }
    const parentId = identity(await parent.stat({ bigint: true }));
    try {
      child = await open(
        path.join(anchor(parent), jobId),
        constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        if (options.requireVideo) throw new ExportStorageUnavailable();
        return { bytes: 0, files: 0 };
      }
      throw error;
    }
    const childId = identity(await child.stat({ bigint: true })),
      names = (await readdir(anchor(child))).sort();
    if (names.length > 2048 || names.some((name) => !validExportFilename(name)))
      throw new ExportStorageUnavailable();
    const seen = new Map<string, string>();
    let bytes = 0n;
    for (const name of names) {
      check();
      let handle: FileHandle | undefined;
      try {
        handle = await open(
          path.join(anchor(child), name),
          constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
        );
        const stat = await handle.stat({ bigint: true });
        if (!stat.isFile() || stat.size < 0n)
          throw new ExportStorageUnavailable();
        bytes += stat.size;
        if (bytes > 4n * 1024n ** 4n) throw new ExportStorageUnavailable();
        seen.set(name, stamp(stat));
      } catch (error) {
        if (
          !options.working ||
          (error as NodeJS.ErrnoException).code !== "ENOENT"
        )
          throw error;
      } finally {
        await handle?.close();
      }
    }
    if (!options.working) {
      const current = (await readdir(anchor(child))).sort();
      if (JSON.stringify(current) !== JSON.stringify(names))
        throw new ExportStorageUnavailable();
      for (const name of names) {
        check();
        const stat = await lstat(path.join(anchor(child), name), {
          bigint: true,
        });
        if (!stat.isFile() || stamp(stat) !== seen.get(name))
          throw new ExportStorageUnavailable();
      }
    }
    if (options.requireVideo && !seen.has("video.mp4"))
      throw new ExportStorageUnavailable();
    const pointer = await lstat(path.join(anchor(parent), jobId), {
        bigint: true,
      }),
      configured = await lstat(root, { bigint: true });
    if (
      !pointer.isDirectory() ||
      identity(pointer) !== childId ||
      !configured.isDirectory() ||
      identity(configured) !== parentId
    )
      throw new ExportStorageUnavailable();
    return { bytes: Number(bytes), files: seen.size };
  } catch (error) {
    if (error instanceof ExportStorageUnavailable) throw error;
    throw new ExportStorageUnavailable();
  } finally {
    await child?.close();
    await parent?.close();
  }
}
