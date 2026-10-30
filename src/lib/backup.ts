import Database from "better-sqlite3";
import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  mkdir,
  lstat,
  readFile,
  readdir,
  copyFile,
  chmod,
  writeFile,
  rename,
  rm,
  realpath,
} from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

const uuid = /^[a-f0-9-]{36}$/;
const entryPath =
  /^(?:data\/(?:studio\.sqlite|auth\.sqlite|auth-secret)|data\/assets\/[a-f0-9-]{36}|artifacts\/[a-f0-9-]{36}\/[a-zA-Z0-9][a-zA-Z0-9._-]{0,119})$/;
const manifestSchema = z.object({
  format: z.literal("reelchemy-backup"),
  version: z.literal(1),
  createdAt: z.string().datetime(),
  entries: z
    .array(
      z.object({
        path: z.string().regex(entryPath),
        bytes: z
          .number()
          .int()
          .min(0)
          .max(100 * 1024 ** 3),
        sha256: z.string().regex(/^[a-f0-9]{64}$/),
      }),
    )
    .min(1)
    .max(100000),
});
type Manifest = z.infer<typeof manifestSchema>;
async function exists(file: string) {
  try {
    await lstat(file);
    return true;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw e;
  }
}
async function canonicalCandidate(file: string): Promise<string> {
  try {
    return await realpath(file);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    const parent = path.dirname(file);
    if (parent === file) throw e;
    return path.join(await canonicalCandidate(parent), path.basename(file));
  }
}
function outside(destination: string, sources: string[]) {
  for (const source of sources) {
    const relative = path.relative(
      path.resolve(source),
      path.resolve(destination),
    );
    if (
      !relative ||
      (!relative.startsWith(`..${path.sep}`) &&
        relative !== ".." &&
        !path.isAbsolute(relative))
    )
      throw new Error(
        "Backup/restore destinations must be outside their source directories.",
      );
  }
}
async function regular(file: string) {
  const stat = await lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink())
    throw new Error(
      "Backups accept regular files only; symbolic links are rejected.",
    );
  return stat;
}
async function digest(file: string) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}
function openVerified(file: string) {
  const db = new Database(file, { readonly: true, fileMustExist: true });
  try {
    const result = db.pragma("integrity_check", { simple: true });
    if (result !== "ok")
      throw new Error("Backup database integrity check failed.");
    return db;
  } catch (e) {
    db.close();
    throw e;
  }
}
async function snapshotDatabase(source: string, target: string) {
  await regular(source);
  const db = openVerified(source),
    deadline = Date.now() + 30000;
  try {
    await db.backup(target, {
      progress: () => {
        if (Date.now() > deadline)
          throw new Error("Database backup timed out.");
        return 1000;
      },
    });
    // Materialize a standalone database. A readonly open of a WAL-mode snapshot
    // can otherwise create sidecars that do not belong in a portable backup.
    const snapshot = new Database(target);
    try {
      snapshot.pragma("journal_mode = DELETE");
    } finally {
      snapshot.close();
    }
    await chmod(target, 0o600);
  } finally {
    db.close();
  }
}
async function copyPrivate(source: string, target: string) {
  await regular(source);
  await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
  await copyFile(source, target);
  await chmod(target, 0o600);
}
async function listedFiles(root: string, prefix = ""): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(path.join(root, prefix), {
    withFileTypes: true,
  })) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) files.push(...(await listedFiles(root, relative)));
    else if (entry.isFile()) files.push(relative);
    else
      throw new Error(
        "Backup contains a symbolic link or unsupported filesystem entry.",
      );
    if (files.length > 100001)
      throw new Error("Backup contains too many files.");
  }
  return files;
}
function snapshotReferences(db: Database.Database) {
  const assets = new Set<string>();
  const projects = db.prepare("SELECT data FROM projects").all() as {
    data: string;
  }[];
  for (const row of projects) {
    const p = JSON.parse(row.data);
    for (const asset of p.assets || []) {
      if (typeof asset.id !== "string" || !uuid.test(asset.id))
        throw new Error("Project contains an invalid asset ID.");
      assets.add(asset.id);
    }
  }
  const jobs = db.prepare("SELECT id,status FROM jobs").all() as {
    id: string;
    status: string;
  }[];
  if (jobs.some((j) => !uuid.test(j.id)))
    throw new Error("Backup contains an invalid job ID.");
  const owners = (
    db.prepare("SELECT owner_id FROM workspaces").all() as {
      owner_id: string;
    }[]
  ).map((w) => w.owner_id);
  return { assets, jobs, owners };
}
// Admin-only filesystem tooling. Stop web, render and mail services first. We do
// not copy live SQLite files/WAL bytes or claim cross-database transactionality.
export async function createBackup(options: {
  data: string;
  auth?: string;
  artifacts: string;
  output: string;
}) {
  const output = path.resolve(options.output),
    data = path.resolve(options.data),
    artifacts = path.resolve(options.artifacts),
    authDirectory = path.resolve(options.auth || options.data);
  outside(
    await canonicalCandidate(output),
    await Promise.all([data, artifacts, authDirectory].map(canonicalCandidate)),
  );
  if (await exists(path.join(data, "worker.lock")))
    throw new Error(
      "Stop the render worker before backing up. After a crash, verify its PID before removing a stale lock.",
    );
  await mkdir(path.dirname(output), { recursive: true, mode: 0o700 });
  await mkdir(output, { mode: 0o700 }); // Exclusive: never overwrite an existing backup.
  try {
    await mkdir(path.join(output, "data"), { mode: 0o700 });
    await snapshotDatabase(
      path.join(data, "studio.sqlite"),
      path.join(output, "data/studio.sqlite"),
    );
    const studio = openVerified(path.join(output, "data/studio.sqlite"));
    let refs: ReturnType<typeof snapshotReferences>;
    try {
      refs = snapshotReferences(studio);
    } finally {
      studio.close();
    }
    if (refs.jobs.some((j) => j.status === "rendering"))
      throw new Error(
        "A render was active in this database snapshot. Stop services cleanly before backup.",
      );
    if (await exists(path.join(authDirectory, "auth.sqlite"))) {
      await snapshotDatabase(
        path.join(authDirectory, "auth.sqlite"),
        path.join(output, "data/auth.sqlite"),
      );
      const auth = openVerified(path.join(output, "data/auth.sqlite"));
      try {
        const find = auth.prepare('SELECT id FROM "user" WHERE id=?');
        if (refs.owners.some((id) => !find.get(id)))
          throw new Error(
            "Backup has a workspace without its account. Stop all writers and retry.",
          );
      } finally {
        auth.close();
      }
    } else if (refs.owners.length)
      throw new Error("Account database is required for owned workspaces.");
    if (await exists(path.join(authDirectory, "auth-secret")))
      await copyPrivate(
        path.join(authDirectory, "auth-secret"),
        path.join(output, "data/auth-secret"),
      );
    for (const id of refs.assets)
      await copyPrivate(
        path.join(data, "assets", id),
        path.join(output, "data/assets", id),
      );
    for (const job of refs.jobs.filter(
      (j) => j.status === "completed" || j.status === "failed",
    )) {
      const source = path.join(artifacts, job.id);
      if (!(await exists(source))) {
        if (job.status === "completed")
          throw new Error("A completed export directory is missing.");
        continue;
      }
      const directory = await lstat(source);
      if (!directory.isDirectory() || directory.isSymbolicLink())
        throw new Error("Invalid export directory.");
      if (job.status === "completed")
        await regular(path.join(source, "video.mp4"));
      for (const file of await readdir(source)) {
        const relative = `artifacts/${job.id}/${file}`;
        if (!entryPath.test(relative))
          throw new Error("Unsupported export filename in backup.");
        await copyPrivate(path.join(source, file), path.join(output, relative));
      }
    }
    const entries: Manifest["entries"] = [];
    for (const file of (await listedFiles(output)).sort())
      entries.push({
        path: file,
        bytes: (await regular(path.join(output, file))).size,
        sha256: await digest(path.join(output, file)),
      });
    const manifest = manifestSchema.parse({
      format: "reelchemy-backup",
      version: 1,
      createdAt: new Date().toISOString(),
      entries,
    });
    const temporary = path.join(output, `manifest-${randomUUID()}.tmp`);
    await writeFile(temporary, JSON.stringify(manifest, null, 2), {
      mode: 0o600,
      flag: "wx",
    });
    await rename(temporary, path.join(output, "manifest.json"));
    await verifyBackup(output);
    return {
      output,
      files: entries.length,
      bytes: entries.reduce((n, e) => n + e.bytes, 0),
    };
  } catch (e) {
    await rm(output, { recursive: true, force: true });
    throw e;
  }
}
export async function verifyBackup(root: string): Promise<Manifest> {
  const directory = await lstat(root);
  if (!directory.isDirectory() || directory.isSymbolicLink())
    throw new Error("Backup must be a regular directory.");
  const manifestFile = path.join(root, "manifest.json");
  if ((await regular(manifestFile)).size > 10 * 1024 * 1024)
    throw new Error("Backup manifest is too large.");
  const manifest = manifestSchema.parse(
    JSON.parse(await readFile(manifestFile, "utf8")),
  );
  const expected = new Set(manifest.entries.map((e) => e.path));
  if (
    expected.size !== manifest.entries.length ||
    !expected.has("data/studio.sqlite")
  )
    throw new Error("Duplicate or missing backup entries.");
  const actual = await listedFiles(root);
  if (
    actual.length !== expected.size + 1 ||
    actual.some((f) => f !== "manifest.json" && !expected.has(f))
  )
    throw new Error("Backup contains unexpected or missing files.");
  for (const entry of manifest.entries) {
    const file = path.join(root, entry.path);
    if (
      (await regular(file)).size !== entry.bytes ||
      (await digest(file)) !== entry.sha256
    )
      throw new Error(`Backup checksum mismatch: ${entry.path}`);
  }
  const studio = openVerified(path.join(root, "data/studio.sqlite"));
  let refs: ReturnType<typeof snapshotReferences>;
  try {
    refs = snapshotReferences(studio);
  } finally {
    studio.close();
  }
  for (const id of refs.assets)
    if (!expected.has(`data/assets/${id}`))
      throw new Error("Backup is missing a referenced media asset.");
  for (const job of refs.jobs)
    if (
      job.status === "completed" &&
      !expected.has(`artifacts/${job.id}/video.mp4`)
    )
      throw new Error("Backup is missing a completed export.");
  if (expected.has("data/auth.sqlite")) {
    const auth = openVerified(path.join(root, "data/auth.sqlite"));
    try {
      const find = auth.prepare('SELECT id FROM "user" WHERE id=?');
      if (refs.owners.some((id) => !find.get(id)))
        throw new Error("Backup has a workspace without its account.");
    } finally {
      auth.close();
    }
  } else if (refs.owners.length)
    throw new Error("Backup is missing its account database.");

  return manifest;
}
export async function restoreBackup(source: string, destination: string) {
  const root = path.resolve(destination);
  outside(await canonicalCandidate(root), [
    await canonicalCandidate(path.resolve(source)),
  ]);
  const manifest = await verifyBackup(source);
  await mkdir(path.dirname(root), { recursive: true, mode: 0o700 });
  await mkdir(root, { mode: 0o700 }); // Existing installations are never overwritten.
  try {
    for (const entry of manifest.entries)
      await copyPrivate(
        path.join(source, entry.path),
        path.join(root, entry.path),
      );
    await mkdir(path.join(root, "data/assets"), {
      recursive: true,
      mode: 0o700,
    });
    await mkdir(path.join(root, "artifacts"), { recursive: true, mode: 0o700 });
    // Backups keep their existing portable v1 layout. Runtime restoration
    // always separates account material, including legacy combined snapshots.
    const authDirectory = path.join(root, "auth");
    await mkdir(authDirectory, { mode: 0o700 });
    for (const name of ["auth.sqlite", "auth-secret"])
      if (await exists(path.join(root, "data", name)))
        await rename(
          path.join(root, "data", name),
          path.join(authDirectory, name),
        );
    const authFile = path.join(authDirectory, "auth.sqlite");
    if (await exists(authFile)) {
      const auth = new Database(authFile);
      try {
        auth.transaction(() => {
          for (const table of ["session", "verification"])
            if (
              auth
                .prepare(
                  "SELECT name FROM sqlite_master WHERE type='table' AND name=?",
                )
                .get(table)
            )
              auth.exec(`DELETE FROM "${table}"`);
        })();
      } finally {
        auth.close();
      }
    }
    const studio = new Database(path.join(root, "data/studio.sqlite"));
    try {
      studio.transaction(() => {
        const rows = studio
          .prepare("SELECT id,status,data FROM jobs")
          .all() as { id: string; status: string; data: string }[];
        for (const row of rows) {
          const job = JSON.parse(row.data);
          if (["queued", "rendering"].includes(row.status)) {
            job.status = "failed";
            job.progress = 0;
            job.stage = "Restored";
            job.error =
              "Restored from backup. Start a new export from the saved project.";
          }
          if (job.report?.export)
            job.report.export.path = path.join(
              root,
              "artifacts",
              job.id,
              "video.mp4",
            );
          studio
            .prepare("UPDATE jobs SET status=?,data=? WHERE id=?")
            .run(job.status, JSON.stringify(job), row.id);
        }
      })();
    } finally {
      studio.close();
    }
    await writeFile(
      path.join(root, "RESTORE.json"),
      JSON.stringify({
        restoredAt: new Date().toISOString(),
        snapshotAt: manifest.createdAt,
        sessionsRevoked: true,
        activeJobsFailed: true,
        authenticationSeparated: true,
      }),
      { mode: 0o600, flag: "wx" },
    );
    return {
      data: path.join(root, "data"),
      auth: authDirectory,
      artifacts: path.join(root, "artifacts"),
      files: manifest.entries.length,
    };
  } catch (e) {
    await rm(root, { recursive: true, force: true });
    throw e;
  }
}
