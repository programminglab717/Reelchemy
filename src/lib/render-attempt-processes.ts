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
type Identity = { started: string; state: string };
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
  return { started: fields[19], state: fields[0] };
}
const dead = (value: Identity) => ["Z", "X"].includes(value.state);
const gone = (error: unknown) =>
  ["ENOENT", "ESRCH"].includes((error as NodeJS.ErrnoException).code ?? "");
async function inspect(pid: string, root: string) {
  if ((await lstat(`/proc/${pid}`)).uid !== process.getuid!()) return;
  const before = await identity(pid);
  if (dead(before)) return;
  const contents = await boundedRead(pid, "environ", 64 * 1024),
    after = await identity(pid);
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
    return id;
}
// Read only same-UID metadata, with before/after PID-start identity. An exiting
// task can briefly lose its address space while its proc entry still exists.
// Recheck that transition; never treat an unreadable live task as stopped.
export async function liveNativeRenderJobs(root: string) {
  const jobs = new Set<string>();
  if (process.platform !== "linux") return jobs;
  for (const name of await readdir("/proc")) {
    if (!/^[0-9]+$/.test(name) || Number(name) <= 1) continue;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const id = await inspect(name, root);
        if (id) jobs.add(id);
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
  return jobs;
}
