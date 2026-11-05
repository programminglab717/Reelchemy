import path from "node:path";
import {
  EncryptedBackupUnavailable,
  inspectEncryptedBackups,
  uploadEncryptedBackup,
  verifyEncryptedBackup,
  expireEncryptedBackups,
} from "../src/lib/encrypted-backup";

const controller = new AbortController();
const cancel = () => controller.abort();
process.on("SIGINT", cancel);
process.on("SIGTERM", cancel);
try {
  const [operation, ...args] = process.argv.slice(2);
  const values = new Map<string, string>();
  let apply = false;
  for (let i = 0; i < args.length; i++) {
    const key = args[i];
    if (key === "--apply" && !apply) {
      apply = true;
      continue;
    }
    if (
      ![
        "--repository-id",
        "--authority-id",
        "--authority-fingerprint",
        "--snapshot",
        "--id",
        "--keep-days",
        "--keep-last",
      ].includes(key) ||
      values.has(key) ||
      !args[i + 1] ||
      args[i + 1].startsWith("--")
    )
      throw new EncryptedBackupUnavailable();
    values.set(key, args[++i]);
  }
  const allowed = new Set([
    "--repository-id",
    "--authority-id",
    "--authority-fingerprint",
    ...(operation === "upload"
      ? ["--snapshot"]
      : operation === "verify"
        ? ["--id"]
        : operation === "expire"
          ? ["--keep-days", "--keep-last"]
          : []),
  ]);
  if (
    [...values.keys()].some((key) => !allowed.has(key)) ||
    (apply && operation !== "expire")
  )
    throw new EncryptedBackupUnavailable();
  const options = {
    repository: process.env.RESTIC_REPOSITORY || "",
    passwordFile: process.env.RESTIC_PASSWORD_FILE || "",
    repositoryId: values.get("--repository-id") || "",
    authorityId: values.get("--authority-id") || "",
    authorityFingerprint: values.get("--authority-fingerprint") || "",
    binary: process.env.REELCHEMY_RESTIC_BINARY,
    timeoutMs: process.env.REELCHEMY_BACKUP_TIMEOUT_MS
      ? Number(process.env.REELCHEMY_BACKUP_TIMEOUT_MS)
      : undefined,
    signal: controller.signal,
  };
  let result: unknown;
  if (operation === "inspect") result = await inspectEncryptedBackups(options);
  else if (operation === "upload" && values.has("--snapshot")) {
    const snapshot = values.get("--snapshot")!;
    if (!path.isAbsolute(snapshot)) throw new EncryptedBackupUnavailable();
    result = await uploadEncryptedBackup(options, snapshot);
  } else if (operation === "verify" && values.has("--id"))
    result = await verifyEncryptedBackup(options, values.get("--id")!);
  else if (operation === "expire")
    result = await expireEncryptedBackups(options, {
      keepDays: values.has("--keep-days")
        ? Number(values.get("--keep-days"))
        : undefined,
      keepLast: values.has("--keep-last")
        ? Number(values.get("--keep-last"))
        : undefined,
      apply,
    });
  else throw new EncryptedBackupUnavailable();
  console.log(JSON.stringify(result));
} catch {
  console.error(new EncryptedBackupUnavailable().message);
  process.exitCode = 1;
} finally {
  process.off("SIGINT", cancel);
  process.off("SIGTERM", cancel);
}
