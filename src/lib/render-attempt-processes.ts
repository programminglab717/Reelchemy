import { readdir, lstat, open } from "node:fs/promises";
import { constants } from "node:fs";
import { z } from "zod";
export const renderJobMarker = "REELCHEMY_RENDER_JOB_ID",
  renderRootMarker = "REELCHEMY_RENDER_STUDIO_ROOT";
export class RenderProcessInspectionError extends Error {
  constructor(
    readonly processId: number,
    readonly reason: string,
  ) {
    super(
      "Interrupted render processes cannot be verified. Contact the studio operator.",
    );
  }
}
type Identity = {
  started: string;
  state: string;
  parent: number;
  name: string;
};
async function boundedRead(
  pid: string,
  name: "stat" | "environ",
  limit: number,
) {
  const handle = await open(
    `/proc/${pid}/${name}`,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  );
  try {
    const bytes = Buffer.alloc(limit + 1),
      { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
    if (bytesRead > limit)
      throw Object.assign(new Error("Process metadata exceeds its bound."), {
        code: "E2BIG",
      });
    return bytes.subarray(0, bytesRead).toString("utf8");
  } finally {
    await handle.close();
  }
}
async function identity(pid: string): Promise<Identity> {
  const source = await boundedRead(pid, "stat", 4096),
    fields = source
      .slice(source.lastIndexOf(")") + 2)
      .trim()
      .split(/\s+/);
  if (
    !source.startsWith(`${pid} (`) ||
    !/^\d{1,30}$/.test(fields[19] ?? "") ||
    !/^[A-Za-z]$/.test(fields[0] ?? "")
  )
    throw Object.assign(new Error("Invalid process identity."), {
      code: "INVALID_STAT",
    });
  return {
    started: fields[19],
    state: fields[0],
    parent: Number(fields[1]),
    name: source.slice(source.indexOf("(") + 1, source.lastIndexOf(")")),
  };
}
// Process names (kernel `comm`, at most 15 bytes) that a render attempt can
// leave behind: the immutable browser launcher, Chromium/headless shell,
// FFmpeg tools, Remotion's compositor and Node helpers. A same-UID process
// whose environment cannot be read is treated as possibly-active render work
// only when its name matches; unrelated non-dumpable programs (ssh/gpg agents,
// CI runner services) must not block recovery forever.
const possibleRenderProcess =
  /^(?:chrome.*|chromium.*|headless_shell|ffmpeg|ffprobe|remotion.*|compositor.*|node|MainThread|render-browser.*|sh|bash|dash)$/;
const dead = (value: Identity) => ["Z", "X"].includes(value.state);
const gone = (error: unknown) =>
  ["ENOENT", "ESRCH"].includes((error as NodeJS.ErrnoException).code ?? "");
async function inspect(pid: string, root: string) {
  if ((await lstat(`/proc/${pid}`)).uid !== process.getuid!()) return;
  const before = await identity(pid);
  if (dead(before)) return;
  let contents: string;
  try {
    contents = await boundedRead(pid, "environ", 64 * 1024);
  } catch (error) {
    if (
      ["EACCES", "EPERM"].includes(
        (error as NodeJS.ErrnoException).code ?? "",
      ) &&
      !possibleRenderProcess.test(before.name)
    )
      return;
    throw error;
  }
  const after = await identity(pid);
  if (dead(after) || before.started !== after.started) return;
  const environment = new Map(
      contents.split("\0").map((value) => {
        const separator = value.indexOf("=");
        return [value.slice(0, separator), value.slice(separator + 1)];
      }),
    ),
    id = environment.get(renderJobMarker);
  if (
    environment.get(renderRootMarker) === root &&
    z.uuid().safeParse(id).success
  )
    return { id: id!, started: after.started };
}
// Read only same-UID metadata, with before/after PID-start identity. An exiting
// task can briefly lose its address space while its proc entry still exists.
// Recheck that transition; never treat an unreadable live task as stopped.
async function nativeRenderProcesses(root: string) {
  const processes = new Map<number, { id: string; started: string }>();
  if (process.platform !== "linux") return processes;
  for (const name of await readdir("/proc")) {
    if (!/^[0-9]+$/.test(name) || Number(name) <= 1) continue;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const found = await inspect(name, root);
        if (found) processes.set(Number(name), found);
        break;
      } catch (error) {
        if (gone(error)) break;
        try {
          if (dead(await identity(name))) break;
        } catch (recheck) {
          if (gone(recheck)) break;
        }
        if (attempt === 0) {
          await new Promise((resolve) => setTimeout(resolve, 20));
          continue;
        }
        const code = (error as NodeJS.ErrnoException).code;
        throw new RenderProcessInspectionError(
          Number(name),
          typeof code === "string" && /^[A-Z0-9_]{1,40}$/.test(code)
            ? code
            : "METADATA_UNAVAILABLE",
        );
      }
    }
  }
  return processes;
}
export async function liveNativeRenderJobs(root: string) {
  return new Set(
    [...(await nativeRenderProcesses(root)).values()].map((entry) => entry.id),
  );
}
async function descendsFromThisProcess(pid: number) {
  let current = pid;
  for (let depth = 0; depth < 64; depth++) {
    let parent: number;
    try {
      parent = (await identity(String(current))).parent;
    } catch (error) {
      if (gone(error)) return false;
      throw error;
    }
    if (parent === process.pid) return true;
    if (!Number.isSafeInteger(parent) || parent <= 1) return false;
    current = parent;
  }
  return false;
}
const pause = (milliseconds: number) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));
// Release the current consumer's OWN marked native processes after an attempt
// has ended (deadline, cancellation or failure). Native libraries can leave a
// child blocked on an abandoned pipe after their promise settles. Wait briefly
// for natural exit, then signal only same-UID descendants of this process that
// carry this job/root marker and the same PID-start identity, escalating from
// SIGTERM to SIGKILL. Processes of earlier consumers or other studios are never
// signalled here; startup recovery still waits for operator review of those.
// Returns false when marked work remains, so callers keep failing closed.
export async function releaseNativeRenderJob(
  root: string,
  jobId: string,
  { graceMs = 3000, signalMs = 5000 } = {},
) {
  const remaining = async () =>
    [...(await nativeRenderProcesses(root))].filter(
      ([, entry]) => entry.id === jobId,
    );
  const waitFor = async (milliseconds: number) => {
    const end = Date.now() + milliseconds;
    for (;;) {
      const live = await remaining();
      if (!live.length || Date.now() >= end) return live;
      await pause(100);
    }
  };
  let live = await waitFor(graceMs);
  for (const signal of ["SIGTERM", "SIGKILL"] as const) {
    if (!live.length) return true;
    for (const [pid, entry] of live) {
      if (!(await descendsFromThisProcess(pid))) continue;
      try {
        const current = await identity(String(pid));
        if (current.started !== entry.started || dead(current)) continue;
        process.kill(pid, signal);
      } catch (error) {
        if (!gone(error)) throw error;
      }
    }
    live = await waitFor(signalMs);
  }
  return !live.length;
}
