import { readdir, lstat, open } from "node:fs/promises";
import { constants } from "node:fs";
import { z } from "zod";
export const renderJobMarker = "REELCHEMY_RENDER_JOB_ID",
  renderRootMarker = "REELCHEMY_RENDER_STUDIO_ROOT";
// Fail closed if same-UID native process metadata is unavailable. Neither a
// free lifetime lock nor a cancelled job proves interrupted children stopped.
export async function liveNativeRenderJobs(root: string) {
  const jobs = new Set<string>();
  if (process.platform !== "linux") return jobs;
  for (const name of await readdir("/proc")) {
    if (!/^[0-9]+$/.test(name) || Number(name) <= 1) continue;
    let handle;
    try {
      if ((await lstat(`/proc/${name}`)).uid !== process.getuid!()) continue;
      handle = await open(
        `/proc/${name}/environ`,
        constants.O_RDONLY | constants.O_NOFOLLOW,
      );
      const bytes = Buffer.alloc(64 * 1024 + 1),
        { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
      if (bytesRead === bytes.length) throw new Error();
      const env = new Map(
        bytes
          .subarray(0, bytesRead)
          .toString("utf8")
          .split("\0")
          .map((v) => {
            const i = v.indexOf("=");
            return [v.slice(0, i), v.slice(i + 1)];
          }),
      );
      const id = env.get(renderJobMarker);
      if (env.get(renderRootMarker) === root && z.uuid().safeParse(id).success)
        jobs.add(id!);
    } catch (error) {
      if (
        !["ENOENT", "ESRCH"].includes(
          (error as NodeJS.ErrnoException).code ?? "",
        )
      )
        throw new Error(
          "Interrupted render processes cannot be verified. Contact the studio operator.",
        );
    } finally {
      await handle?.close();
    }
  }
  return jobs;
}
