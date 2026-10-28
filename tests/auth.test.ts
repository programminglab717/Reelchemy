import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
process.env.REELCHEMY_DATA_DIR = await mkdtemp(
  path.join(tmpdir(), "reelchemy-auth-unit-"),
);
test("local authentication initializes idempotently with private signing and account files", async () => {
  const { getAuth, migrateAuth } = await import("../src/lib/auth");
  const a = await getAuth();
  await migrateAuth();
  assert.equal(await getAuth(), a);
  for (const name of ["auth.sqlite", "auth-secret"])
    assert.equal(
      (await stat(path.join(process.env.REELCHEMY_DATA_DIR!, name))).mode &
        0o777,
      0o600,
    );
});
