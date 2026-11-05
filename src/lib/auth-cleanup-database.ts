import { enableSecureDeletion } from "./sqlite-private";
import Database from "better-sqlite3";
import {
  constants,
  openSync,
  closeSync,
  fstatSync,
  lstatSync,
  realpathSync,
} from "node:fs";
import path from "node:path";
import { authStorageDirectory } from "./auth-storage";
import { assertAuthErasureSchema } from "./auth-erasure-store";
import { AccountErasureUnavailable } from "./account-erasure-policy";
import type { PrivacyVault } from "./privacy-vault";

// Cleanup needs existing account storage, never the web signing secret, a mail
// transport or schema initialization. Keep the parent inode pinned until close.
export function openAuthCleanupDatabase(vault: PrivacyVault) {
  let parent: number | undefined;
  let database: Database.Database | undefined;
  try {
    if (process.platform !== "linux") throw new AccountErasureUnavailable();
    const configured = authStorageDirectory();
    const directory = realpathSync(configured);
    parent = openSync(
      directory,
      constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
    );
    const root = fstatSync(parent);
    if (!root.isDirectory() || (root.mode & 0o077) !== 0)
      throw new AccountErasureUnavailable();
    const anchor = `/proc/self/fd/${parent}`;
    const filename = path.join(anchor, "auth.sqlite");
    function regular(file: string, optional = false) {
      try {
        const info = lstatSync(file);
        if (!info.isFile() || info.nlink !== 1 || (info.mode & 0o077) !== 0)
          throw new AccountErasureUnavailable();
        return info;
      } catch (error) {
        if (optional && (error as NodeJS.ErrnoException).code === "ENOENT")
          return;
        throw error;
      }
    }
    const original = regular(filename)!;
    const checkFiles = () => {
      const currentRoot = lstatSync(realpathSync(configured));
      if (currentRoot.dev !== root.dev || currentRoot.ino !== root.ino)
        throw new AccountErasureUnavailable();
      const file = regular(filename)!;
      if (file.dev !== original.dev || file.ino !== original.ino)
        throw new AccountErasureUnavailable();
      regular(filename + "-wal", true);
      regular(filename + "-shm", true);
    };
    checkFiles();
    database = new Database(filename, { fileMustExist: true });
    database.pragma("busy_timeout=5000");
    enableSecureDeletion(database);
    checkFiles();
    assertAuthErasureSchema(database, vault);
    const opened = database,
      fd = parent;
    let closed = false;
    return {
      database: opened,
      assertCurrent() {
        try {
          if (closed) throw new AccountErasureUnavailable();
          checkFiles();
          assertAuthErasureSchema(opened, vault);
        } catch {
          throw new AccountErasureUnavailable();
        }
      },
      close() {
        if (closed) return;
        closed = true;
        try {
          opened.close();
        } finally {
          closeSync(fd);
        }
      },
    };
  } catch {
    try {
      database?.close();
    } finally {
      if (parent !== undefined) closeSync(parent);
    }
    throw new AccountErasureUnavailable();
  }
}
