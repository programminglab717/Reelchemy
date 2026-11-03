import { test } from "node:test";
import assert from "node:assert/strict";
import {
  exportStoragePolicy,
  ExportStorageLimit,
} from "../src/lib/export-storage-policy";
import { LimitConfigurationError } from "../src/lib/limits-policy";
test("retained export defaults reserve bounded output within ordered studio/shared allowances", () => {
  assert.deepEqual(exportStoragePolicy({}), {
    reservationBytes: 512 * 1024 ** 2,
    studioBytes: 2 * 1024 ** 3,
    serviceBytes: 8 * 1024 ** 3,
    studioExports: 100,
    serviceExports: 2000,
  });
  assert.equal(
    exportStoragePolicy({ REELCHEMY_EXPORT_RESERVATION_BYTES: "1048576" })
      .reservationBytes,
    1048576,
  );
});
test("malformed, unsafe or inconsistent export limits fail closed and output stays reclaimable by the public reviewed-file bound", () => {
  for (const raw of [
    "0",
    "-1",
    "1.5",
    "1e9",
    " 1048576",
    "9007199254740992",
    "1073741825",
  ]) {
    assert.throws(
      () => exportStoragePolicy({ REELCHEMY_EXPORT_RESERVATION_BYTES: raw }),
      LimitConfigurationError,
    );
  }
  for (const env of [
    { REELCHEMY_EXPORT_STUDIO_BYTES: "1048576" },
    { REELCHEMY_EXPORT_STUDIO_BYTES: "17179869184" },
    { REELCHEMY_EXPORT_STUDIO_COUNT: "2001" },
    { REELCHEMY_EXPORT_SERVICE_COUNT: "0" },
  ])
    assert.throws(() => exportStoragePolicy(env), LimitConfigurationError);
});
test("shared storage errors expose no other studio counts or usage", () => {
  const error = new ExportStorageLimit("service", "bytes");
  assert.equal(error.scope, "service");
  assert.equal(error.code, "EXPORT_STORAGE_LIMIT");
  assert(!/\d/.test(error.message));
  assert.deepEqual(Object.keys(error).sort(), [
    "code",
    "kind",
    "retryAfter",
    "scope",
  ]);
});
