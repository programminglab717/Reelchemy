import { constants } from "node:fs";
import {
  open,
  realpath,
  lstat,
  unlink,
  rm,
  type FileHandle,
} from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import {
  dataDir,
  artifactDir,
  claimProjectDeletion,
  reserveProjectDeletionMedia,
  finishProjectDeletion,
  failProjectDeletion,
} from "./db";
import { renderCacheWorkspaceDirectory } from "./render-cache-path";

async function directoryAnchor(directory: string, configuredRoot = false) {
  let handle: FileHandle;
  let root = directory;
  try {
    if (configuredRoot) root = await realpath(root);
    handle = await open(
      root,
      constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
  // Linux workers keep a stable directory inode even if a path is renamed.
  // Production already requires the Linux kernel-lock entrypoint.
  try {
    const anchored =
      process.platform === "linux"
        ? `/proc/self/fd/${handle.fd}`
        : await realpath(root);
    return { root: anchored, close: () => handle.close() };
  } catch (error) {
    await handle.close();
    throw error;
  }
}
async function removeEntry(
  root: string | undefined,
  id: string,
  directory: boolean,
) {
  z.uuid().parse(id);
  if (!root) return;
  const file = path.join(root, id);
  let meta;
  try {
    meta = await lstat(file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  if (meta.isSymbolicLink() || meta.isFile()) await unlink(file);
  else if (directory && meta.isDirectory())
    await rm(file, { recursive: true, force: true });
  else throw new Error("Unexpected cleanup entry type.");
}

// Invoke only between exports, while the worker's lifetime kernel lock is held.
// No web route imports this filesystem operation.
export async function processProjectDeletion(isStopping: () => boolean) {
  const task = claimProjectDeletion();
  if (!task) return false;
  const anchors: { close: () => Promise<void> }[] = [];
  try {
    if (isStopping()) return true;
    const assets = reserveProjectDeletionMedia(task);
    const media = await directoryAnchor(path.join(dataDir, "assets"));
    if (media) anchors.push(media);
    for (const id of assets) {
      if (isStopping()) return true;
      await removeEntry(media?.root, id, false);
    }
    const exports = await directoryAnchor(artifactDir, true);
    if (exports) anchors.push(exports);
    for (const id of task.manifest.jobs) {
      if (isStopping()) return true;
      await removeEntry(exports?.root, id, true);
    }
    if (isStopping()) return true;
    const cache = renderCacheWorkspaceDirectory(task.workspaceId);
    const cacheParent = await directoryAnchor(path.dirname(cache), true);
    if (cacheParent) anchors.push(cacheParent);
    await removeEntry(cacheParent?.root, task.workspaceId, true);
    if (isStopping()) return true;
    finishProjectDeletion(task);
    console.log(
      JSON.stringify({
        event: "project.delete.complete",
        projectId: task.projectId,
      }),
    );
  } catch (error) {
    failProjectDeletion(task);
    console.error(
      JSON.stringify({
        event: "project.delete.failed",
        projectId: task.projectId,
        code:
          typeof (error as NodeJS.ErrnoException).code === "string"
            ? (error as NodeJS.ErrnoException).code
            : "CLEANUP_FAILED",
      }),
    );
  } finally {
    await Promise.all(anchors.map((anchor) => anchor.close()));
  }
  return true;
}
