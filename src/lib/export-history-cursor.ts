import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import { constants, openSync, fstatSync, readSync, closeSync } from "node:fs";
import path from "node:path";
import { authStorageDirectory } from "./auth-storage";

// Use a domain-separated key without initializing accounts or signing files.
// Public cursors never expose shared SQLite row numbers. They confer no access:
// the caller rechecks the active project owner before encoding/decoding them.
function key() {
  let secret = process.env.BETTER_AUTH_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV === "production") throw new Error();
    const fd = openSync(
      path.join(authStorageDirectory(), "auth-secret"),
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    try {
      const info = fstatSync(fd);
      if (!info.isFile() || info.size < 32 || info.size > 4096)
        throw new Error();
      const bytes = Buffer.alloc(info.size);
      if (readSync(fd, bytes, 0, bytes.length, 0) !== bytes.length)
        throw new Error();
      secret = bytes.toString("utf8");
    } finally {
      closeSync(fd);
    }
  }
  if (secret.length < 32) throw new Error();
  return createHash("sha256")
    .update("reelchemy-export-history-cursor-v1\0")
    .update(secret)
    .digest();
}
const aad = (
  projectId: string,
  workspaceId: string,
  purpose: "anchor" | "before",
  domain?: "workspace-job-history",
) =>
  Buffer.from(
    JSON.stringify([
      domain
        ? "reelchemy-workspace-job-history-v1"
        : "reelchemy-export-history-v1",
      workspaceId,
      projectId,
      purpose,
    ]),
  );
export function encodeExportCursor(
  projectId: string,
  workspaceId: string,
  purpose: "anchor" | "before",
  values: readonly number[],
  domain?: "workspace-job-history",
) {
  if (
    values.length !== (purpose === "anchor" ? 1 : 2) ||
    values.some((n) => !Number.isSafeInteger(n) || n < 0)
  )
    throw new Error();
  const plaintext = Buffer.alloc(values.length * 8);
  values.forEach((n, i) => plaintext.writeBigUInt64BE(BigInt(n), i * 8));
  const nonce = randomBytes(12),
    cipher = createCipheriv("aes-256-gcm", key(), nonce);
  cipher.setAAD(aad(projectId, workspaceId, purpose, domain));
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return `v1.${Buffer.concat([nonce, cipher.getAuthTag(), encrypted]).toString("base64url")}`;
}
export function decodeExportCursor(
  token: string,
  projectId: string,
  workspaceId: string,
  purpose: "anchor" | "before",
  domain?: "workspace-job-history",
) {
  if (typeof token !== "string" || !/^v1\.[A-Za-z0-9_-]{48,60}$/.test(token))
    throw new Error();
  const bytes = Buffer.from(token.slice(3), "base64url");
  if (
    bytes.toString("base64url") !== token.slice(3) ||
    bytes.length !== (purpose === "anchor" ? 36 : 44)
  )
    throw new Error();
  const decipher = createDecipheriv(
    "aes-256-gcm",
    key(),
    bytes.subarray(0, 12),
  );
  decipher.setAAD(aad(projectId, workspaceId, purpose, domain));
  decipher.setAuthTag(bytes.subarray(12, 28));
  const plaintext = Buffer.concat([
    decipher.update(bytes.subarray(28)),
    decipher.final(),
  ]);
  const values = Array.from({ length: plaintext.length / 8 }, (_, i) =>
    Number(plaintext.readBigUInt64BE(i * 8)),
  );
  if (values.some((n) => !Number.isSafeInteger(n) || n < 0)) throw new Error();
  return values;
}
