import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import {
  mkdtemp,
  writeFile,
  readdir,
  readFile,
  open,
  lstat,
  unlink,
  rmdir,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const markerName = "REELCHEMY_RENDER_BROWSER_ATTEMPT";
type Identity = { pid: number; started: string; parent: number; state: string };
export class RenderBrowserCleanupError extends Error {
  constructor() {
    super(
      "The export browser could not be released safely. Contact the studio operator.",
    );
  }
}
function parseIdentity(pid: number, source: string): Identity {
  const fields = source
    .slice(source.lastIndexOf(")") + 2)
    .trim()
    .split(/\s+/);
  if (!Number.isSafeInteger(pid) || pid <= 1 || !/^\d+$/.test(fields[19] || ""))
    throw new RenderBrowserCleanupError();
  return {
    pid,
    started: fields[19],
    parent: Number(fields[1]),
    state: fields[0],
  };
}
async function identity(pid: number) {
  try {
    return parseIdentity(pid, await readFile(`/proc/${pid}/stat`, "utf8"));
  } catch (error) {
    if (
      ["ENOENT", "ESRCH"].includes((error as NodeJS.ErrnoException).code || "")
    )
      return;
    throw error;
  }
}
async function executing(target: Identity) {
  const current = await identity(target.pid);
  return (
    current &&
    current.started === target.started &&
    !["Z", "X"].includes(current.state)
  );
}
async function fixedRead(file: string, max: number) {
  const handle = await open(
    file,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  );
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size > max)
      throw new RenderBrowserCleanupError();
    const bytes = Buffer.alloc(info.size);
    const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
    if (bytesRead !== bytes.length) throw new RenderBrowserCleanupError();
    return bytes.toString("utf8");
  } finally {
    await handle.close();
  }
}
export async function prepareRenderBrowser(executable: string) {
  if (process.platform !== "linux")
    return { executable, userAgent: undefined, close: async () => {} };
  if (
    /[\r\n\0]/.test(executable) ||
    /[\r\n\0]/.test(tmpdir()) ||
    !path.isAbsolute(tmpdir())
  )
    throw new RenderBrowserCleanupError();
  const root = await mkdtemp(path.join(tmpdir(), "reelchemy-render-browser-")),
    token = randomUUID();
  const directory = await open(
    root,
    constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
  );
  const original = await directory.stat({ bigint: true }),
    anchor = `/proc/${process.pid}/fd/${directory.fd}`;
  const cleanDirectory = async () => {
    const names = await readdir(anchor);
    for (const name of names) {
      if (
        !["config", "process", "profile"].includes(name) ||
        !(await lstat(path.join(anchor, name))).isFile()
      )
        throw new RenderBrowserCleanupError();
    }
    for (const name of names) await unlink(path.join(anchor, name));
    const pointer = await lstat(root, { bigint: true }).catch((error) => {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    });
    if (
      pointer?.isDirectory() &&
      pointer.dev === original.dev &&
      pointer.ino === original.ino
    )
      await rmdir(root);
  };
  try {
    await writeFile(
      path.join(anchor, "config"),
      `${token}\n${path.resolve(executable)}\n${path.resolve(tmpdir())}\n`,
      { mode: 0o600, flag: "wx" },
    );
  } catch (error) {
    try {
      await cleanDirectory();
    } finally {
      await directory.close();
    }
    throw error;
  }
  let closing: Promise<void> | undefined;
  const cleanProfile = async () => {
    let record: string;
    try {
      record = await fixedRead(path.join(anchor, "profile"), 4096);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
    const [profile, fingerprint] = record.split("\n");
    if (
      path.dirname(profile) !== path.resolve(tmpdir()) ||
      !/^puppeteer_dev_chrome_profile-[a-zA-Z0-9]{6}$/.test(
        path.basename(profile),
      ) ||
      !/^\d+:\d+$/.test(fingerprint)
    )
      throw new RenderBrowserCleanupError();
    let handle;
    try {
      handle = await open(
        profile,
        constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
    try {
      const metadata = await handle.stat({ bigint: true });
      if (`${metadata.dev}:${metadata.ino}` !== fingerprint)
        throw new RenderBrowserCleanupError();
      const pinned = `/proc/${process.pid}/fd/${handle.fd}`;
      for (const name of await readdir(pinned))
        await rm(path.join(pinned, name), { recursive: true, force: true });
      const current = await lstat(profile, { bigint: true });
      if (
        !current.isDirectory() ||
        current.dev !== metadata.dev ||
        current.ino !== metadata.ino
      )
        throw new RenderBrowserCleanupError();
      await rmdir(profile);
    } finally {
      await handle.close();
    }
  };
  return {
    executable: fileURLToPath(
      new URL("../../scripts/render-browser-launcher.sh", import.meta.url),
    ),
    // The immutable launcher removes this internal control argument before
    // executing Chromium; the browser retains its normal user agent.
    userAgent: `ReelchemyRenderAttempt/${anchor}`,
    close: () =>
      (closing ??= (async () => {
        try {
          const all = new Map<number, Identity>(),
            targets = new Map<number, Identity>();
          let recorded: Identity | undefined;
          try {
            const lines = (
              await fixedRead(path.join(anchor, "process"), 4096)
            ).split("\n");
            recorded = parseIdentity(Number(lines[0]), lines[1]);
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
          }
          for (const entry of await readdir("/proc")) {
            if (!/^\d+$/.test(entry)) continue;
            const pid = Number(entry);
            if (pid <= 1) continue;
            const current = await identity(pid);
            if (!current || ["Z", "X"].includes(current.state)) continue;
            all.set(pid, current);
            if (recorded?.pid === pid && recorded.started === current.started)
              targets.set(pid, current);
            try {
              const env = await readFile(`/proc/${pid}/environ`, "utf8");
              if (env.split("\0").includes(`${markerName}=${token}`)) {
                const check = await identity(pid);
                if (check?.started === current.started)
                  targets.set(pid, current);
              }
            } catch (error) {
              if (
                !["ENOENT", "ESRCH", "EACCES", "EPERM"].includes(
                  (error as NodeJS.ErrnoException).code || "",
                )
              )
                throw error;
            }
          }
          // Snapshot descendants before terminating the launcher. Marker lookup
          // also finds detached/orphaned children that inherited this attempt.
          let size: number;
          do {
            size = targets.size;
            for (const target of all.values())
              if (targets.has(target.parent)) targets.set(target.pid, target);
          } while (targets.size !== size);
          const signal = async (value: NodeJS.Signals) => {
            for (const target of [...targets.values()].reverse()) {
              if (!(await executing(target))) continue;
              try {
                process.kill(target.pid, value);
              } catch (error) {
                if ((error as NodeJS.ErrnoException).code !== "ESRCH")
                  throw error;
              }
            }
          };
          const active = async () =>
            (await Promise.all([...targets.values()].map(executing))).some(
              Boolean,
            );
          await signal("SIGTERM");
          const grace = Date.now() + 500;
          while ((await active()) && Date.now() < grace)
            await new Promise((resolve) => setTimeout(resolve, 25));
          if (await active()) {
            await signal("SIGKILL");
            const deadline = Date.now() + 2000;
            while ((await active()) && Date.now() < deadline)
              await new Promise((resolve) => setTimeout(resolve, 25));
            if (await active()) throw new RenderBrowserCleanupError();
          }
          await cleanProfile();
          await cleanDirectory();
        } catch {
          throw new RenderBrowserCleanupError();
        } finally {
          await directory.close();
        }
      })()),
  };
}
