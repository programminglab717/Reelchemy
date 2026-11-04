import { z } from "zod";
import { configuredPrivacyVault } from "../src/lib/privacy-storage";
import { erasureApprovalForRequest } from "../src/lib/privacy-vault";
import { openAuthCleanupDatabase } from "../src/lib/auth-cleanup-database";
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
import { assertRestoreComplete } from "../src/lib/restore-state";
import {
  resolveErasureOwner,
  retryErasedProjects,
} from "../src/lib/account-erasure-cleanup-store";

// This operator command must not import db.ts: opening the application store
// would initialize/migrate a wrong or empty installation before refusing it.
function openStudio() {
  const configured = path.resolve(process.env.REELCHEMY_DATA_DIR || ".data");
  assertRestoreComplete(configured);
  const directory = realpathSync(configured);
  const parent = openSync(
    directory,
    constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
  );
  let db: Database.Database | undefined;
  try {
    const root = fstatSync(parent);
    if (!root.isDirectory() || (root.mode & 0o077) !== 0) throw new Error();
    const file = `/proc/self/fd/${parent}/studio.sqlite`;
    function regular(name: string, optional = false) {
      try {
        const info = lstatSync(name);
        if (!info.isFile() || info.nlink !== 1 || (info.mode & 0o077) !== 0)
          throw new Error();
        return info;
      } catch (error) {
        if (optional && (error as NodeJS.ErrnoException).code === "ENOENT")
          return;
        throw error;
      }
    }
    const original = regular(file)!;
    const assertCurrent = () => {
      assertRestoreComplete(configured);
      const currentRoot = lstatSync(realpathSync(configured));
      const currentFile = regular(file)!;
      if (
        currentRoot.dev !== root.dev ||
        currentRoot.ino !== root.ino ||
        currentFile.dev !== original.dev ||
        currentFile.ino !== original.ino
      )
        throw new Error();
      regular(file + "-wal", true);
      regular(file + "-shm", true);
    };
    assertCurrent();
    db = new Database(file, { fileMustExist: true });
    db.pragma("busy_timeout=5000");
    assertCurrent();
    const opened = db;
    return {
      db: opened,
      assertCurrent,
      close() {
        try {
          opened.close();
        } finally {
          closeSync(parent);
        }
      },
    };
  } catch (error) {
    try {
      db?.close();
    } finally {
      closeSync(parent);
    }
    throw error;
  }
}
const args = process.argv.slice(2);
try {
  if (
    (args.length !== 2 && args.length !== 4) ||
    args[0] !== "--request" ||
    (args.length === 4 && args[2] !== "--limit")
  )
    throw new Error();
  const requestId = z.uuid().parse(args[1]);
  const raw = args[3] || "5";
  if (!/^[1-5]$/.test(raw)) throw new Error();
  const vault = configuredPrivacyVault();
  const accounts = openAuthCleanupDatabase(vault);
  try {
    const approved = erasureApprovalForRequest(vault, requestId);
    if (!approved || approved.status.state === "completed") throw new Error();
    const studio = openStudio();
    try {
      accounts.assertCurrent();
      studio.assertCurrent();
      const context = resolveErasureOwner(
        studio.db,
        vault,
        requestId,
        approved.approval.workspaceId,
      );
      console.log(
        JSON.stringify({
          requestId,
          ...retryErasedProjects(studio.db, vault, context, Number(raw)),
        }),
      );
    } finally {
      studio.close();
    }
  } finally {
    accounts.close();
  }
} catch {
  console.error(
    "Account cleanup retry unavailable. Use --request <pending-request-uuid> [--limit 1..5] with current authority and migrated private storage. Correct the underlying cleanup failure first.",
  );
  process.exitCode = 1;
}
