import {
  spawn,
  type ChildProcess,
  type SpawnOptions,
} from "node:child_process";
import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
const owned = new WeakMap<ChildProcess, string>();
const grouped = process.platform !== "win32";
const markerName = "REELCHEMY_TEST_PROCESS_ANCESTORS";

export function spawnTestProcess(
  command: string,
  args: string[],
  options: SpawnOptions,
) {
  const marker = randomUUID();
  const env = options.env || process.env;
  const ancestors = env[markerName] ? `${env[markerName]}:${marker}` : marker;
  const child = spawn(command, args, {
    ...options,
    env: { ...env, [markerName]: ancestors },
    detached: grouped,
  });
  owned.set(child, marker);
  return child;
}
// Chromium can detach from its launcher. Identify only descendants inheriting
// this spawn's private marker, including orphans; never log environment data.
function markedProcesses(marker: string) {
  const ids: number[] = [];
  for (const id of readdirSync("/proc").filter((id) => /^\d+$/.test(id))) {
    try {
      const entry = readFileSync(`/proc/${id}/environ`, "utf8")
        .split("\0")
        .find((value) => value.startsWith(`${markerName}=`));
      if (
        entry
          ?.slice(markerName.length + 1)
          .split(":")
          .includes(marker)
      )
        ids.push(Number(id));
    } catch (error) {
      if (
        !["ENOENT", "ESRCH", "EACCES", "EPERM"].includes(
          (error as NodeJS.ErrnoException).code || "",
        )
      )
        throw error;
    }
  }
  return ids;
}
export function signalTestProcess(child: ChildProcess, signal: NodeJS.Signals) {
  const marker = owned.get(child);
  if (!marker) throw new Error("Refusing to signal an unowned test process.");
  if (!child.pid) return;
  if (process.platform === "linux") {
    for (const pid of markedProcesses(marker)) {
      try {
        process.kill(pid, signal);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
      }
    }
    return;
  }
  try {
    if (grouped) process.kill(-child.pid, signal);
    else child.kill(signal);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
  }
}
function alive(child: ChildProcess) {
  if (!child.pid) return false;
  if (process.platform === "linux")
    return markedProcesses(owned.get(child)!).length > 0;
  if (!grouped) return child.exitCode === null && child.signalCode === null;
  try {
    process.kill(-child.pid, 0);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ESRCH") return false;
    throw error;
  }
}
type Identity = { pid: number; started: string };
function identity(pid: number) {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
    const fields = stat.slice(stat.lastIndexOf(")") + 2).split(/\s+/);
    return { pid, started: fields[19], state: fields[0] };
  } catch (error) {
    if (
      ["ENOENT", "ESRCH"].includes((error as NodeJS.ErrnoException).code || "")
    )
      return;
    throw error;
  }
}
function executing(targets: Identity[]) {
  return targets.some((target) => {
    const current = identity(target.pid);
    return (
      current &&
      current.started === target.started &&
      !["Z", "X"].includes(current.state)
    );
  });
}
export async function shutdownTestProcesses(
  children: ChildProcess[],
  graceMs = 12000,
) {
  const results = await Promise.allSettled(
    children.map(async (child) => {
      const marker = owned.get(child);
      if (!marker) throw new Error("Refusing to stop an unowned test process.");
      const targets: Identity[] =
        process.platform === "linux"
          ? markedProcesses(marker)
              .map(identity)
              .filter((item): item is NonNullable<typeof item> => !!item)
          : [];
      signalTestProcess(child, "SIGTERM");
      const deadline = Date.now() + graceMs;
      while ((alive(child) || executing(targets)) && Date.now() < deadline)
        await new Promise((resolve) => setTimeout(resolve, 50));
      if (alive(child) || executing(targets)) {
        signalTestProcess(child, "SIGKILL");
        const killedBy = Date.now() + 2000;
        while ((alive(child) || executing(targets)) && Date.now() < killedBy)
          await new Promise((resolve) => setTimeout(resolve, 25));
        if (alive(child) || executing(targets))
          throw new Error("Owned test descendants did not stop after SIGKILL.");
      }
      if (child.exitCode === null && child.signalCode === null)
        await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, 1000);
          child.once("close", () => {
            clearTimeout(timer);
            resolve();
          });
        });
    }),
  );
  const failures = results.filter((result) => result.status === "rejected");
  if (failures.length)
    throw new Error(
      `Could not stop ${failures.length} owned test process groups.`,
    );
}
