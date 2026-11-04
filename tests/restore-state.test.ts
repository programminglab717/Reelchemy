import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync, existsSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { assertRestoreComplete } from "../src/lib/restore-state";
import { authStorageDirectory } from "../src/lib/auth-storage";
test("an incomplete restore refuses account and studio startup before any storage initialization", () => {
  const root = mkdtempSync(path.join(tmpdir(), "reelchemy-restore-barrier-")),
    data = path.join(root, "data"),
    marker = path.join(root, "RESTORE_PENDING.json");
  try {
    writeFileSync(
      marker,
      JSON.stringify({ startedAt: new Date().toISOString() }),
      { mode: 0o600 },
    );
    assert.throws(
      () => assertRestoreComplete(data),
      /Restore reconciliation is incomplete/,
    );
    assert.throws(
      () =>
        authStorageDirectory({ NODE_ENV: "test", REELCHEMY_DATA_DIR: data }),
      /Restore reconciliation is incomplete/,
    );
    assert.throws(
      () =>
        execFileSync(
          process.execPath,
          [
            "--import",
            "tsx",
            "--input-type=module",
            "--eval",
            "await import('./src/lib/db.ts')",
          ],
          { env: { ...process.env, REELCHEMY_DATA_DIR: data }, stdio: "pipe" },
        ),
      /Command failed/,
    );
    assert.equal(existsSync(data), false);
    rmSync(marker);
    assert.doesNotThrow(() => assertRestoreComplete(data));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
test("production schema migration checks the independent authority before creating studio or account storage", () => {
  const root = mkdtempSync(
    path.join(tmpdir(), "reelchemy-migration-privacy-preflight-"),
  );
  const data = path.join(root, "data"),
    accounts = path.join(root, "auth"),
    privacy = path.join(root, "missing-authority");
  try {
    assert.throws(
      () =>
        execFileSync(
          process.execPath,
          ["--import", "tsx", "scripts/migrate.ts"],
          {
            env: {
              ...process.env,
              NODE_ENV: "production",
              REELCHEMY_DATA_DIR: data,
              REELCHEMY_AUTH_DIR: accounts,
              REELCHEMY_ARTIFACT_DIR: path.join(root, "artifacts"),
              REELCHEMY_PRIVACY_DIR: privacy,
              REELCHEMY_PRIVACY_ID: randomUUID(),
              REELCHEMY_PRIVACY_KEY_FINGERPRINT: "0".repeat(64),
            },
            stdio: "pipe",
          },
        ),
      /Command failed/,
    );
    assert.equal(existsSync(data), false);
    assert.equal(existsSync(accounts), false);
    assert.equal(existsSync(privacy), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
