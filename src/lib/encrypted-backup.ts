import { spawn } from "node:child_process";
import { constants } from "node:fs";
import {
  open,
  mkdtemp,
  lstat,
  readFile,
  rm,
  realpath,
  statfs,
  type FileHandle,
} from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { z } from "zod";
import { verifyBackup } from "./backup";

const digest = /^[a-f0-9]{64}$/;
const snapshotSchema = z.object({
  id: z.string().regex(digest),
  time: z.string().datetime({ offset: true }),
  hostname: z.string().max(200),
  paths: z.array(z.string().min(1).max(4096)).length(1),
  tags: z.array(z.string().max(200)).max(30),
});
type RemoteSnapshot = z.infer<typeof snapshotSchema>;
export type EncryptedBackupOptions = {
  repository: string;
  passwordFile: string;
  repositoryId: string;
  authorityId: string;
  authorityFingerprint: string;
  binary?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
};
export class EncryptedBackupUnavailable extends Error {
  constructor() {
    super(
      "Encrypted backup operation unavailable. Check the explicit repository/authority pins, private password file, repository locks, free space and completed snapshot. No live application data is initialized or repaired. A started remote mutation may have completed; inspect the repository before retrying.",
    );
  }
}
// Backend credentials are available only to the dedicated operator tool. Never
// inherit application signing, model, mail, SSH/rclone or password-command config.
const backendVariables = [
  "AWS_ACCESS_KEY_ID",
  "AWS_SECRET_ACCESS_KEY",
  "AWS_SESSION_TOKEN",
  "AWS_DEFAULT_REGION",
  "AWS_REGION",
  "SSL_CERT_FILE",
  "SSL_CERT_DIR",
  "HTTPS_PROXY",
  "HTTP_PROXY",
  "NO_PROXY",
  "https_proxy",
  "http_proxy",
  "no_proxy",
] as const;
function configuration(options: EncryptedBackupOptions) {
  if (
    process.platform !== "linux" ||
    !digest.test(options.repositoryId) ||
    !digest.test(options.authorityFingerprint) ||
    !z.uuid().safeParse(options.authorityId).success ||
    !path.isAbsolute(options.passwordFile) ||
    options.repository.length > 2048 ||
    options.repository.includes("\0") ||
    (options.timeoutMs !== undefined &&
      (!Number.isInteger(options.timeoutMs) ||
        options.timeoutMs < 100 ||
        options.timeoutMs > 45 * 60 * 1000))
  )
    throw new EncryptedBackupUnavailable();
  if (!path.isAbsolute(options.repository)) {
    if (!options.repository.startsWith("s3:https://"))
      throw new EncryptedBackupUnavailable();
    const address = new URL(options.repository.slice(3));
    if (
      !address.hostname ||
      address.username ||
      address.password ||
      address.search ||
      address.hash
    )
      throw new EncryptedBackupUnavailable();
  }
  const binary = options.binary || "/usr/bin/restic";
  if (!path.isAbsolute(binary)) throw new EncryptedBackupUnavailable();
  return {
    binary,
    host: `reelchemy-${options.authorityId}`,
    tags: [
      "reelchemy-backup-v1",
      `authority-${options.authorityId}`,
      `key-${options.authorityFingerprint}`,
    ],
  };
}
async function passwordDescriptor(file: string) {
  const handle = await open(
    file,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  );
  try {
    const info = await handle.stat();
    if (
      !info.isFile() ||
      info.uid !== process.getuid?.() ||
      info.nlink !== 1 ||
      (info.mode & 0o077) !== 0 ||
      info.size < 16 ||
      info.size > 4096
    )
      throw new EncryptedBackupUnavailable();
    return handle;
  } catch (error) {
    await handle.close();
    throw error;
  }
}
async function withRepository<T>(
  options: EncryptedBackupOptions,
  operation: (session: {
    run: (args: string[], cwd?: string) => Promise<string>;
    snapshots: () => Promise<RemoteSnapshot[]>;
    home: string;
    host: string;
    tags: string[];
  }) => Promise<T>,
): Promise<T> {
  let directory: string | undefined,
    identity: { dev: number; ino: number } | undefined,
    password: FileHandle | undefined;
  try {
    const config = configuration(options);
    if (options.signal?.aborted) throw new EncryptedBackupUnavailable();
    password = await passwordDescriptor(options.passwordFile);
    directory = await mkdtemp(path.join(tmpdir(), "reelchemy-encrypted-"));
    identity = await lstat(directory);
    const env: NodeJS.ProcessEnv = {
      NODE_ENV: process.env.NODE_ENV || "production",
      PATH: process.env.PATH || "/usr/bin:/bin",
      HOME: directory,
      TMPDIR: directory,
      XDG_CACHE_HOME: directory,
      LANG: "C.UTF-8",
      TZ: "UTC",
      RESTIC_REPOSITORY: options.repository,
      RESTIC_PASSWORD_FILE: "/proc/self/fd/3",
      GOMAXPROCS: "2",
    };
    for (const name of backendVariables)
      if (process.env[name] !== undefined) env[name] = process.env[name];
    const run = async (args: string[], cwd?: string) => {
      if (options.signal?.aborted) throw new EncryptedBackupUnavailable();
      return await new Promise<string>((resolve, reject) => {
        const child = spawn(config.binary, ["--no-cache", "--json", ...args], {
          cwd,
          env,
          stdio: ["ignore", "pipe", "pipe", password!.fd],
        });
        const chunks: Buffer[] = [];
        let bytes = 0,
          stopped = false,
          escalation: ReturnType<typeof setTimeout> | undefined;
        const stop = () => {
          if (stopped) return;
          stopped = true;
          child.kill("SIGTERM");
          escalation = setTimeout(() => child.kill("SIGKILL"), 1000);
        };
        const timeout = setTimeout(stop, options.timeoutMs ?? 15 * 60 * 1000);
        const cancelled = () => stop();
        options.signal?.addEventListener("abort", cancelled, { once: true });
        const cleanup = () => {
          clearTimeout(timeout);
          clearTimeout(escalation);
          options.signal?.removeEventListener("abort", cancelled);
        };
        child.stdout!.on("data", (chunk: Buffer) => {
          bytes += chunk.length;
          if (bytes > 12 * 1024 ** 2) stop();
          else chunks.push(chunk);
        });
        child.stderr!.on("data", (chunk: Buffer) => {
          bytes += chunk.length;
          if (bytes > 12 * 1024 ** 2) stop();
        });
        child.once("error", () => {
          cleanup();
          reject(new EncryptedBackupUnavailable());
        });
        child.once("close", (code) => {
          cleanup();
          if (stopped || code !== 0) reject(new EncryptedBackupUnavailable());
          else resolve(Buffer.concat(chunks).toString("utf8"));
        });
        if (options.signal?.aborted) stop();
      });
    };
    // Every operation authenticates the encrypted repository before selecting
    // any data; a mistyped destination never gets initialized by this wrapper.
    const repository = z
      .object({
        id: z.string().regex(digest),
        version: z.union([z.literal(1), z.literal(2)]),
      })
      .parse(JSON.parse(await run(["cat", "config"])));
    if (repository.id !== options.repositoryId)
      throw new EncryptedBackupUnavailable();
    const snapshots = async () => {
      const entries = z
        .array(snapshotSchema)
        .max(1000)
        .parse(
          JSON.parse(
            await run([
              "snapshots",
              "--host",
              config.host,
              "--tag",
              config.tags.join(","),
            ]),
          ) || [],
        );
      if (
        entries.some(
          (s) =>
            s.hostname !== config.host ||
            config.tags.some((tag) => !s.tags.includes(tag)),
        )
      )
        throw new EncryptedBackupUnavailable();
      return entries.sort(
        (a, b) =>
          Date.parse(b.time) - Date.parse(a.time) || a.id.localeCompare(b.id),
      );
    };
    return await operation({
      run,
      snapshots,
      home: directory,
      host: config.host,
      tags: config.tags,
    });
  } catch {
    throw new EncryptedBackupUnavailable();
  } finally {
    await password?.close();
    if (directory && identity) {
      const current = await lstat(directory).catch(() => undefined);
      // Never recursively clean a substituted directory. Restic itself owns
      // repository locks; this wrapper never removes them to force admission.
      if (
        current?.isDirectory() &&
        current.dev === identity.dev &&
        current.ino === identity.ino
      )
        await rm(directory, { recursive: true, force: true });
    }
  }
}

type Session = Parameters<Parameters<typeof withRepository>[1]>[0];
function fresh(createdAt: string) {
  const age = Date.now() - Date.parse(createdAt);
  return (
    Number.isFinite(age) && age >= -5 * 60 * 1000 && age <= 24 * 60 * 60 * 1000
  );
}
function manifestIdentity(value: unknown, options: EncryptedBackupOptions) {
  const parsed = z
    .object({
      format: z.literal("reelchemy-backup"),
      createdAt: z.string().datetime(),
      privacy: z.object({
        id: z.uuid(),
        keyFingerprint: z.string().regex(digest),
      }),
      entries: z
        .array(z.object({ bytes: z.number().int().nonnegative() }))
        .min(1)
        .max(100000),
    })
    .parse(value);
  if (
    parsed.privacy.id !== options.authorityId ||
    parsed.privacy.keyFingerprint !== options.authorityFingerprint
  )
    throw new EncryptedBackupUnavailable();
  return parsed;
}
async function restoreAndVerify(
  session: Session,
  options: EncryptedBackupOptions,
  snapshot: RemoteSnapshot,
) {
  const stored = await session.run([
    "dump",
    snapshot.id,
    path.posix.join(snapshot.paths[0], "manifest.json"),
  ]);
  const manifest = manifestIdentity(JSON.parse(stored), options);
  const expectedHash = `manifest-${createHash("sha256").update(stored).digest("hex")}`;
  if (!snapshot.tags.includes(expectedHash))
    throw new EncryptedBackupUnavailable();
  const bytes = manifest.entries.reduce((sum, entry) => sum + entry.bytes, 0);
  const capacity = await statfs(session.home, { bigint: true });
  if (
    !Number.isSafeInteger(bytes) ||
    BigInt(bytes) + 64n * 1024n ** 2n > capacity.bavail * capacity.bsize
  )
    throw new EncryptedBackupUnavailable();
  const source = snapshot.paths[0];
  if (
    !path.posix.isAbsolute(source) ||
    source.split("/").some((part) => part === "." || part === "..") ||
    source.includes("\0")
  )
    throw new EncryptedBackupUnavailable();
  const target = path.join(session.home, "restore");
  await session.run(["restore", snapshot.id, "--target", target]);
  const restored = path.join(target, source.slice(1));
  const verified = await verifyBackup(restored, { signal: options.signal });
  manifestIdentity(verified, options);
  if (
    createHash("sha256")
      .update(await readFile(path.join(restored, "manifest.json")))
      .digest("hex") !== expectedHash.slice(9)
  )
    throw new EncryptedBackupUnavailable();
  return {
    id: snapshot.id,
    createdAt: verified.createdAt,
    files: verified.entries.length,
    bytes,
  };
}

export async function inspectEncryptedBackups(options: EncryptedBackupOptions) {
  return withRepository(options, async (session) => {
    const snapshots = await session.snapshots();
    return {
      repositoryId: options.repositoryId,
      authorityId: options.authorityId,
      snapshots: snapshots.map((s) => ({ id: s.id, createdAt: s.time })),
      latestFresh: !!snapshots[0] && fresh(snapshots[0].time),
    };
  });
}
export async function uploadEncryptedBackup(
  options: EncryptedBackupOptions,
  input: string,
) {
  return withRepository(options, async (session) => {
    if (!path.isAbsolute(input)) throw new EncryptedBackupUnavailable();
    const source = await realpath(input),
      info = await lstat(input);
    if (
      source !== path.resolve(input) ||
      !info.isDirectory() ||
      info.isSymbolicLink() ||
      info.uid !== process.getuid?.() ||
      (info.mode & 0o077) !== 0
    )
      throw new EncryptedBackupUnavailable();
    if (path.isAbsolute(options.repository)) {
      const repository = await realpath(options.repository);
      for (const [a, b] of [
        [source, repository],
        [repository, source],
      ]) {
        const relative = path.relative(a, b);
        if (
          !relative ||
          (relative !== ".." &&
            !relative.startsWith(`..${path.sep}`) &&
            !path.isAbsolute(relative))
        )
          throw new EncryptedBackupUnavailable();
      }
    }
    const manifest = await verifyBackup(source, { signal: options.signal });
    manifestIdentity(manifest, options);
    if (!fresh(manifest.createdAt)) throw new EncryptedBackupUnavailable();
    const hash = createHash("sha256")
      .update(await readFile(path.join(source, "manifest.json")))
      .digest("hex");
    const output = await session.run(
      [
        "backup",
        ".",
        "--host",
        session.host,
        ...[...session.tags, `manifest-${hash}`].flatMap((tag) => [
          "--tag",
          tag,
        ]),
      ],
      source,
    );
    const summary = output
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line))
      .find((entry) => entry.message_type === "summary");
    const prefix = z
      .string()
      .regex(/^[a-f0-9]{8,64}$/)
      .parse(summary?.snapshot_id);
    const matches = (await session.snapshots()).filter((s) =>
      s.id.startsWith(prefix),
    );
    const current = await lstat(input);
    if (
      matches.length !== 1 ||
      current.dev !== info.dev ||
      current.ino !== info.ino ||
      current.isSymbolicLink()
    )
      throw new EncryptedBackupUnavailable();
    await verifyBackup(source, { signal: options.signal });
    if (
      createHash("sha256")
        .update(await readFile(path.join(source, "manifest.json")))
        .digest("hex") !== hash
    )
      throw new EncryptedBackupUnavailable();
    return {
      id: matches[0].id,
      files: manifest.entries.length,
      createdAt: manifest.createdAt,
    };
  });
}
export async function verifyEncryptedBackup(
  options: EncryptedBackupOptions,
  id: string,
) {
  return withRepository(options, async (session) => {
    if (!digest.test(id)) throw new EncryptedBackupUnavailable();
    const snapshot = (await session.snapshots()).find((s) => s.id === id);
    if (!snapshot) throw new EncryptedBackupUnavailable();
    return {
      verified: true,
      ...(await restoreAndVerify(session, options, snapshot)),
    };
  });
}
export async function expireEncryptedBackups(
  options: EncryptedBackupOptions,
  policy: { keepDays?: number; keepLast?: number; apply?: boolean } = {},
) {
  const keepDays = policy.keepDays ?? 30,
    keepLast = policy.keepLast ?? 7;
  if (
    !Number.isInteger(keepDays) ||
    keepDays < 7 ||
    keepDays > 365 ||
    !Number.isInteger(keepLast) ||
    keepLast < 2 ||
    keepLast > 60
  )
    throw new EncryptedBackupUnavailable();
  return withRepository(options, async (session) => {
    const before = await session.snapshots();
    if (!before.length)
      return {
        applied: false,
        snapshots: 0,
        keepDays,
        keepLast,
        expireIds: [],
        latestFresh: false,
      };
    const args = [
      "forget",
      "--host",
      session.host,
      "--tag",
      session.tags.join(","),
      "--group-by",
      "host",
      "--keep-within",
      `${keepDays}d`,
      "--keep-last",
      String(keepLast),
    ];
    const groups = z
      .array(
        z.object({
          keep: z.array(snapshotSchema).optional(),
          remove: z.array(snapshotSchema).optional(),
        }),
      )
      .max(1)
      .parse(JSON.parse(await session.run([...args, "--dry-run"])));
    const expireIds = groups
      .flatMap((group) => group.remove || [])
      .map((s) => s.id);
    if (expireIds.some((id) => !before.some((s) => s.id === id)))
      throw new EncryptedBackupUnavailable();
    const latestFresh = fresh(before[0].time);
    if (!policy.apply)
      return {
        applied: false,
        snapshots: before.length,
        keepDays,
        keepLast,
        expireIds,
        latestFresh,
      };
    if (!latestFresh) throw new EncryptedBackupUnavailable();
    // A full authenticated restore/checksum/reference drill must pass before
    // applying the retention policy. Restic owns repository write/prune locks.
    const anchor = await restoreAndVerify(session, options, before[0]);
    if (!fresh(anchor.createdAt)) throw new EncryptedBackupUnavailable();
    await session.run([...args, "--prune"]);
    const after = await session.snapshots();
    return {
      applied: true,
      snapshots: after.length,
      keepDays,
      keepLast,
      expireIds: before
        .filter((s) => !after.some((a) => a.id === s.id))
        .map((s) => s.id),
      latestFresh: !!after[0] && fresh(after[0].time),
      verifiedAnchor: anchor.id,
    };
  });
}
