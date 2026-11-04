import { randomUUID } from "node:crypto";
import { readFileSync, unlinkSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { authStorageDirectory } from "./auth-storage";
import { withPrivateDirectory } from "./private-directory";
import { readPrivateMailJson, publishPrivateMailJson } from "./mail-outbox";
import { AccountErasureUnavailable } from "./account-erasure-policy";
const identitySchema = z
  .object({
    kind: z.literal("reelchemy-privacy-worker-v1"),
    pid: z.number().int().min(2),
    started: z.string().regex(/^[0-9]+$/),
    instanceId: z.uuid(),
  })
  .strict();
const heartbeatSchema = identitySchema.extend({
  at: z.iso.datetime(),
  ready: z.boolean(),
});
export type PrivacyWorkerIdentity = z.infer<typeof identitySchema>;
function birth(pid: number) {
  const value = readFileSync(`/proc/${pid}/stat`, "utf8");
  if (value.length > 8192) throw new AccountErasureUnavailable();
  const fields = value.slice(value.lastIndexOf(")") + 2).split(/\s+/);
  if (!/^[0-9]+$/.test(fields[19] || "")) throw new AccountErasureUnavailable();
  return { started: fields[19], state: fields[0] };
}
function directory<T>(run: (anchor: string) => T) {
  return withPrivateDirectory(
    authStorageDirectory(),
    "privacy-worker",
    run,
    false,
  );
}
function current(anchor: string, identity: PrivacyWorkerIdentity) {
  const value = heartbeatSchema.parse(
    readPrivateMailJson(anchor, "heartbeat.json", 1024),
  );
  if (
    value.instanceId !== identity.instanceId ||
    value.pid !== identity.pid ||
    value.started !== identity.started
  )
    throw new AccountErasureUnavailable();
}
export function startPrivacyWorkerState(): PrivacyWorkerIdentity {
  if (
    process.platform !== "linux" ||
    process.env.REELCHEMY_PRIVACY_KERNEL_LOCK !== "1"
  )
    throw new AccountErasureUnavailable();
  return directory((anchor) => {
    try {
      heartbeatSchema.parse(
        readPrivateMailJson(anchor, "heartbeat.json", 1024),
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const identity: PrivacyWorkerIdentity = {
      kind: "reelchemy-privacy-worker-v1",
      pid: process.pid,
      started: birth(process.pid).started,
      instanceId: randomUUID(),
    };
    publishPrivateMailJson(anchor, "heartbeat.json", {
      ...identity,
      at: new Date().toISOString(),
      ready: false,
    });
    return identity;
  });
}
export function heartbeatPrivacyWorker(
  identity: PrivacyWorkerIdentity,
  ready: boolean,
) {
  directory((anchor) => {
    current(anchor, identity);
    publishPrivateMailJson(anchor, "heartbeat.json", {
      ...identity,
      at: new Date().toISOString(),
      ready,
    });
  });
}
export function stopPrivacyWorkerState(identity: PrivacyWorkerIdentity) {
  directory((anchor) => {
    current(anchor, identity);
    unlinkSync(path.join(anchor, "heartbeat.json"));
  });
}
export function privacyWorkerHealthy(now = Date.now()) {
  try {
    return directory((anchor) => {
      const value = heartbeatSchema.parse(
          readPrivateMailJson(anchor, "heartbeat.json", 1024),
        ),
        age = now - Date.parse(value.at),
        process = birth(value.pid);
      return (
        value.ready &&
        age >= -1000 &&
        age <= 20000 &&
        process.started === value.started &&
        !["Z", "X"].includes(process.state)
      );
    });
  } catch {
    return false;
  }
}
