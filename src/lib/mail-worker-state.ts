import { randomUUID } from "node:crypto";
import { readFileSync, unlinkSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import {
  mailDirectoryTransaction,
  readPrivateMailJson,
  publishPrivateMailJson,
} from "./mail-outbox";
import { withPrivateDirectory } from "./private-directory";
import { authStorageDirectory } from "./auth-storage";
import { MailUnavailable } from "./mail-policy";
const identitySchema = z
  .object({
    kind: z.literal("reelchemy-mail-worker-v1"),
    pid: z.number().int().min(2),
    instanceId: z.uuid(),
    started: z.string().regex(/^[0-9]+$/),
  })
  .strict();
export type MailWorkerIdentity = z.infer<typeof identitySchema>;
const heartbeatSchema = identitySchema.extend({
  updatedAt: z.iso.datetime(),
  ready: z.boolean(),
});
function missing(error: unknown) {
  return (error as NodeJS.ErrnoException).code === "ENOENT";
}
function processIdentity(pid: number) {
  const value = readFileSync(`/proc/${pid}/stat`, "utf8");
  if (value.length > 8192) throw new MailUnavailable();
  const fields = value.slice(value.lastIndexOf(")") + 2).split(/\s+/);
  if (!fields[19] || !/^[0-9]+$/.test(fields[19])) throw new MailUnavailable();
  return { started: fields[19], state: fields[0] };
}
export function startMailWorkerState(): MailWorkerIdentity {
  return mailDirectoryTransaction((anchor) => {
    try {
      const old = readPrivateMailJson(anchor, "worker.lock", 512);
      if (typeof old === "number") {
        if (!Number.isSafeInteger(old) || old < 2) throw new MailUnavailable();
        try {
          const previous = processIdentity(old);
          if (previous && !["Z", "X"].includes(previous.state))
            throw new MailUnavailable();
        } catch (error) {
          if (
            (error as NodeJS.ErrnoException).code !== "ENOENT" &&
            (error as NodeJS.ErrnoException).code !== "ESRCH"
          )
            throw error;
        }
      } else identitySchema.parse(old);
      // The kernel lock, rather than a possibly reused PID in diagnostics,
      // proves that a previous managed worker cannot still be executing.
    } catch (error) {
      if (!missing(error)) throw error;
    }
    const identity: MailWorkerIdentity = {
      kind: "reelchemy-mail-worker-v1",
      pid: process.pid,
      instanceId: randomUUID(),
      started: processIdentity(process.pid)!.started,
    };
    publishPrivateMailJson(anchor, "worker.lock", identity);
    publishPrivateMailJson(anchor, "heartbeat.json", {
      ...identity,
      updatedAt: new Date().toISOString(),
      ready: false,
    });
    return identity;
  });
}
function assertCurrent(anchor: string, identity: MailWorkerIdentity) {
  const current = identitySchema.parse(
    readPrivateMailJson(anchor, "worker.lock", 512),
  );
  if (
    current.instanceId !== identity.instanceId ||
    current.pid !== identity.pid
  )
    throw new MailUnavailable();
}
export function heartbeatMailWorker(
  identity: MailWorkerIdentity,
  ready: boolean,
) {
  mailDirectoryTransaction((anchor) => {
    assertCurrent(anchor, identity);
    publishPrivateMailJson(anchor, "heartbeat.json", {
      ...identity,
      updatedAt: new Date().toISOString(),
      ready,
    });
  });
}
export function stopMailWorkerState(identity: MailWorkerIdentity) {
  mailDirectoryTransaction((anchor) => {
    assertCurrent(anchor, identity);
    for (const name of ["heartbeat.json", "worker.lock"]) {
      try {
        unlinkSync(path.join(anchor, name));
      } catch (error) {
        if (!missing(error)) throw error;
      }
    }
  });
}
export function mailWorkerHealthy(now = Date.now()) {
  try {
    return withPrivateDirectory(authStorageDirectory(), "mail", (anchor) => {
      const identity = identitySchema.parse(
        readPrivateMailJson(anchor, "worker.lock", 512),
      );
      const heartbeat = heartbeatSchema.parse(
        readPrivateMailJson(anchor, "heartbeat.json", 1024),
      );
      const age = now - Date.parse(heartbeat.updatedAt);
      if (
        heartbeat.instanceId !== identity.instanceId ||
        heartbeat.pid !== identity.pid ||
        heartbeat.started !== identity.started ||
        !heartbeat.ready ||
        age < -1000 ||
        age > 20000
      )
        return false;
      const process = processIdentity(identity.pid);
      return (
        !!process &&
        process.started === identity.started &&
        !["Z", "X"].includes(process.state)
      );
    });
  } catch {
    return false;
  }
}
