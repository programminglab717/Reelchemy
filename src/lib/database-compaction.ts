import Database from "better-sqlite3";
import {
  constants,
  openSync,
  closeSync,
  fstatSync,
  lstatSync,
  realpathSync,
  readSync,
  statfsSync,
} from "node:fs";
import path from "node:path";

type Kind = "studio" | "auth";
type Identity = { dev: number; ino: number };
export type DatabaseFootprint = {
  kind: Kind;
  bytes: number;
  walBytes: number;
  sharedMemoryBytes: number;
  basePageSize: number;
  basePages: number;
  baseFreePages: number;
};
export type CompactedDatabase = {
  kind: Kind;
  before: DatabaseFootprint;
  after: DatabaseFootprint;
  pages: number;
  freePages: number;
};
export class DatabaseCompactionUnavailable extends Error {
  constructor(readonly completed: CompactedDatabase[] = []) {
    super(
      "Database compaction unavailable. Stop all studio services, use existing private data/account directories, and check storage capacity before retrying. Completed scopes remain logically intact; no migration or record deletion is performed.",
    );
  }
}
const same = (a: Identity, b: Identity) => a.dev === b.dev && a.ino === b.ino;
function privateFile(file: string, optional = false) {
  try {
    const info = lstatSync(file);
    if (
      !info.isFile() ||
      info.nlink !== 1 ||
      (info.mode & 0o077) !== 0 ||
      info.uid !== process.getuid?.()
    )
      throw new DatabaseCompactionUnavailable();
    return info;
  } catch (error) {
    if (optional && (error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
}
function openPinned(directory: string, kind: Kind) {
  if (process.platform !== "linux" || !path.isAbsolute(directory))
    throw new DatabaseCompactionUnavailable();
  const canonical = realpathSync(directory);
  const parent = openSync(
    canonical,
    constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
  );
  try {
    const root = fstatSync(parent);
    if (
      !root.isDirectory() ||
      (root.mode & 0o077) !== 0 ||
      root.uid !== process.getuid?.()
    )
      throw new DatabaseCompactionUnavailable();
    const file = `/proc/self/fd/${parent}/${kind}.sqlite`;
    const original = privateFile(file)!;
    const assertCurrent = () => {
      const currentRoot = lstatSync(realpathSync(directory));
      if (
        !same(currentRoot, root) ||
        !currentRoot.isDirectory() ||
        (currentRoot.mode & 0o077) !== 0 ||
        currentRoot.uid !== process.getuid?.() ||
        !same(privateFile(file)!, original)
      )
        throw new DatabaseCompactionUnavailable();
      privateFile(file + "-wal", true);
      privateFile(file + "-shm", true);
      // An unclean rollback-mode transaction needs ordinary SQLite recovery,
      // never a maintenance operation against an ambiguously active journal.
      try {
        lstatSync(file + "-journal");
        throw new DatabaseCompactionUnavailable();
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    };
    const footprint = (): DatabaseFootprint => {
      assertCurrent();
      const fd = openSync(
        file,
        constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
      );
      try {
        const before = fstatSync(fd),
          header = Buffer.alloc(100);
        if (
          !same(before, original) ||
          readSync(fd, header, 0, header.length, 0) !== header.length ||
          header.subarray(0, 16).toString("binary") !== "SQLite format 3\0"
        )
          throw new DatabaseCompactionUnavailable();
        const pageSize =
          header.readUInt16BE(16) === 1 ? 65536 : header.readUInt16BE(16);
        if (
          pageSize < 512 ||
          pageSize > 65536 ||
          (pageSize & (pageSize - 1)) !== 0
        )
          throw new DatabaseCompactionUnavailable();
        const after = fstatSync(fd);
        if (
          before.size !== after.size ||
          before.mtimeMs !== after.mtimeMs ||
          before.ctimeMs !== after.ctimeMs
        )
          throw new DatabaseCompactionUnavailable();
        assertCurrent();
        return {
          kind,
          bytes: before.size,
          walBytes: privateFile(file + "-wal", true)?.size || 0,
          sharedMemoryBytes: privateFile(file + "-shm", true)?.size || 0,
          basePageSize: pageSize,
          basePages: header.readUInt32BE(28),
          baseFreePages: header.readUInt32BE(36),
        };
      } finally {
        closeSync(fd);
      }
    };
    assertCurrent();
    return {
      kind,
      canonical,
      file,
      parent,
      assertCurrent,
      footprint,
      close: () => closeSync(parent),
    };
  } catch (error) {
    closeSync(parent);
    throw error;
  }
}
type Pinned = ReturnType<typeof openPinned>;
function pinnedPair(data: string, auth: string) {
  const opened: Pinned[] = [];
  try {
    opened.push(openPinned(data, "studio"));
    opened.push(openPinned(auth, "auth"));
    const files = opened.map((p) => privateFile(p.file)!);
    if (same(files[0], files[1])) throw new DatabaseCompactionUnavailable();
    return opened.sort((a, b) =>
      `${a.canonical}/${a.kind}`.localeCompare(`${b.canonical}/${b.kind}`),
    );
  } catch (error) {
    for (const p of opened) p.close();
    throw error;
  }
}
// Inspection reads headers and metadata through pinned descriptors only. It does
// not open SQLite, create missing paths/sidecars, migrate or checkpoint a store.
export function inspectDatabaseStorage(data: string, auth: string) {
  let pinned: Pinned[] = [];
  try {
    pinned = pinnedPair(data, auth);
    return {
      format: "reelchemy-database-storage-v1" as const,
      databases: pinned.map((p) => p.footprint()),
      note: "Base-file page counters exclude uncheckpointed WAL changes. Compaction requires all services stopped and keeps every current logical row. Prior backups, snapshots, open downloads and storage-device remanence have separate retention policies.",
    };
  } catch {
    throw new DatabaseCompactionUnavailable();
  } finally {
    for (const p of pinned) p.close();
  }
}
// Hold both exclusive SQLite connections before performing maintenance. WAL
// readers and writers, including a second maintenance command, make acquisition
// fail; a new connection cannot read/write until both scopes close. VACUUM keeps
// database inodes and logical rows; it never swaps a replacement beneath readers.
export function compactInactiveDatabases(data: string, auth: string) {
  let pinned: Pinned[] = [];
  const connections: Database.Database[] = [],
    completed: CompactedDatabase[] = [];
  try {
    pinned = pinnedPair(data, auth);
    for (const p of pinned) {
      p.footprint();
      const db = new Database(p.file, { fileMustExist: true, timeout: 0 });
      connections.push(db);
      p.assertCurrent();
      if (db.pragma("locking_mode=EXCLUSIVE", { simple: true }) !== "exclusive")
        throw new DatabaseCompactionUnavailable();
      db.exec("BEGIN EXCLUSIVE; COMMIT");
      p.assertCurrent();
    }
    // Verify role and integrity for BOTH stores before compacting either one.
    for (const [index, p] of pinned.entries()) {
      const db = connections[index],
        names =
          p.kind === "studio"
            ? ["projects", "jobs", "workspaces"]
            : ["user", "session"];
      for (const name of names)
        if (
          !db
            .prepare(
              "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?",
            )
            .get(name)
        )
          throw new DatabaseCompactionUnavailable();
      if (db.pragma("integrity_check", { simple: true }) !== "ok")
        throw new DatabaseCompactionUnavailable();
      const footprint = p.footprint(),
        free = statfsSync(p.canonical, { bigint: true });
      const needed =
        BigInt(footprint.bytes + footprint.walBytes) * 2n + 16n * 1024n ** 2n;
      if (free.bavail * free.bsize < needed)
        throw new DatabaseCompactionUnavailable();
    }
    for (const [index, p] of pinned.entries()) {
      const db = connections[index],
        before = p.footprint();
      p.assertCurrent();
      const checkpoint = () => {
        const [row] = db.pragma("wal_checkpoint(TRUNCATE)") as {
          busy: number;
          log: number;
          checkpointed: number;
        }[];
        if (!row || row.busy !== 0 || row.log > 0)
          throw new DatabaseCompactionUnavailable();
      };
      checkpoint();
      db.pragma("secure_delete=ON");
      db.exec("VACUUM");
      checkpoint();
      p.assertCurrent();
      if (db.pragma("integrity_check", { simple: true }) !== "ok")
        throw new DatabaseCompactionUnavailable();
      completed.push({
        kind: p.kind,
        before,
        after: p.footprint(),
        pages: db.pragma("page_count", { simple: true }) as number,
        freePages: db.pragma("freelist_count", { simple: true }) as number,
      });
    }
    return {
      format: "reelchemy-database-compaction-v1" as const,
      completed,
      note: "Current database free pages were compacted and WALs truncated under exclusive locks. This is not forensic erasure of previous backups, host snapshots, memory or storage-device remnants.",
    };
  } catch {
    throw new DatabaseCompactionUnavailable(completed);
  } finally {
    for (const db of connections.reverse()) {
      try {
        db.close();
      } catch {
        /* Release remaining scopes even if one close fails. */
      }
    }
    for (const p of pinned) p.close();
  }
}
