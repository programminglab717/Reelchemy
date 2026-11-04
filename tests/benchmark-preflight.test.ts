import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  writeFileSync,
  readFileSync,
  mkdirSync,
  existsSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { tmpdir } from "node:os";

test("synthetic benchmarks refuse existing outputs, invalid limits and live-storage descendants without initializing sources", () => {
  const root = mkdtempSync(
    path.join(tmpdir(), "reelchemy-benchmark-preflight-"),
  );
  try {
    const output = path.join(root, "existing"),
      data = path.join(root, "data");
    mkdirSync(output, { mode: 0o700 });
    mkdirSync(data, { mode: 0o700 });
    const canary = path.join(output, "keep.txt");
    writeFileSync(canary, "Synthetic source canary");
    for (const args of [
      [`--output=${output}`],
      [`--output=${path.join(root, "invalid")}`, "--duration=9999"],
      [`--output=${path.join(root, "invalid")}`, "--resolution=4k"],
      [`--output=${path.join(data, "must-not-create")}`],
      [
        `--output=${path.join(root, "invalid")}`,
        "--duration=5",
        "--duration=60",
      ],
    ]) {
      const result = spawnSync(
        process.execPath,
        ["--import", "tsx", "scripts/benchmark-video.ts", ...args],
        {
          env: {
            ...process.env,
            REELCHEMY_DATA_DIR: data,
            REELCHEMY_AUTH_DIR: path.join(root, "auth"),
            REELCHEMY_ARTIFACT_DIR: path.join(root, "exports"),
          },
          encoding: "utf8",
          timeout: 10000,
        },
      );
      assert.equal(result.error, undefined);
      assert.equal(result.signal, null);
      assert.equal(result.status, 1, result.stdout + result.stderr);
      assert.equal(result.stdout, "");
      assert.match(
        result.stderr,
        /Synthetic benchmark unavailable or incomplete/,
      );
    }
    assert.deepEqual(readdirSync(data), []);
    assert.deepEqual(readdirSync(output), ["keep.txt"]);
    assert.equal(readFileSync(canary, "utf8"), "Synthetic source canary");
    assert.equal(existsSync(path.join(root, "invalid")), false);
    assert.equal(existsSync(path.join(root, "auth")), false);
    assert.equal(existsSync(path.join(root, "exports")), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
