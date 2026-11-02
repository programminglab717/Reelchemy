import Database from "better-sqlite3";
import { lstat } from "node:fs/promises";
import path from "node:path";
import {
  storageUsage,
  StorageUsageUnavailable,
} from "../src/lib/storage-usage";
let db: Database.Database | undefined;
try {
  const args = process.argv.slice(2);
  let workspaceId: string | undefined;
  if (
    args.length === 2 &&
    args[0] === "--workspace" &&
    /^[a-zA-Z0-9_-]{1,80}$/.test(args[1])
  )
    workspaceId = args[1];
  else if (args.length)
    throw new Error("Usage: npm run storage:usage -- [--workspace ID]");
  const directory = path.resolve(process.env.REELCHEMY_DATA_DIR || ".data"),
    file = path.join(directory, "studio.sqlite"),
    root = await lstat(directory),
    source = await lstat(file);
  if (
    !root.isDirectory() ||
    root.isSymbolicLink() ||
    !source.isFile() ||
    source.isSymbolicLink()
  )
    throw new StorageUsageUnavailable();
  db = new Database(file, { readonly: true, fileMustExist: true });
  console.log(JSON.stringify(storageUsage(db, workspaceId), null, 2));
} catch {
  console.error(
    "Storage usage is unavailable. Use npm run storage:usage -- [--workspace ID] with an existing migrated private database. No database, authentication or media files were initialized or repaired.",
  );
  process.exitCode = 1;
} finally {
  db?.close();
}
