import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  symlinkSync,
  existsSync,
} from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import {
  configuredPrivacyVault,
  privacyStorageDirectory,
} from "../src/lib/privacy-storage";
import {
  initializePrivacyVault,
  privacyVaultWatermark,
} from "../src/lib/privacy-vault";
import { AccountErasureUnavailable } from "../src/lib/account-erasure-policy";
function fixture(
  run: (root: string, env: Record<string, string | undefined>) => void,
) {
  const root = mkdtempSync(path.join(tmpdir(), "reelchemy-privacy-storage-"));
  try {
    const env = {
      NODE_ENV: "production",
      REELCHEMY_DATA_DIR: path.join(root, "data"),
      REELCHEMY_AUTH_DIR: path.join(root, "auth"),
      REELCHEMY_ARTIFACT_DIR: path.join(root, "artifacts"),
      REELCHEMY_RENDER_CACHE_DIR: path.join(root, "cache"),
    };
    for (const directory of Object.values(env).slice(1)) mkdirSync(directory);
    run(root, env);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
test("privacy authority paths are disjoint from data, credentials, exports and caches through canonical aliases", () =>
  fixture((root, env) => {
    const selected = path.join(root, "independent");
    assert.equal(privacyStorageDirectory(selected, env), selected);
    for (const directory of [root, ...Object.values(env).slice(1)]) {
      assert.throws(
        () => privacyStorageDirectory(directory!, env),
        AccountErasureUnavailable,
      );
      if (directory !== root)
        assert.throws(
          () => privacyStorageDirectory(path.join(directory!, "nested"), env),
          AccountErasureUnavailable,
        );
    }
    const alias = path.join(root, "alias");
    symlinkSync(env.REELCHEMY_DATA_DIR!, alias, "dir");
    assert.throws(
      () => privacyStorageDirectory(path.join(alias, "nested"), env),
      AccountErasureUnavailable,
    );
    assert.throws(
      () => privacyStorageDirectory("relative-vault", env),
      AccountErasureUnavailable,
    );
  }));
test("missing or partial external pins never select or initialize an empty replacement authority", () =>
  fixture((root, env) => {
    const directory = path.join(root, "missing");
    const configured = {
      ...env,
      REELCHEMY_PRIVACY_DIR: directory,
      REELCHEMY_PRIVACY_ID: randomUUID(),
      REELCHEMY_PRIVACY_KEY_FINGERPRINT: "0".repeat(64),
    };
    for (const key of [
      "REELCHEMY_PRIVACY_DIR",
      "REELCHEMY_PRIVACY_ID",
      "REELCHEMY_PRIVACY_KEY_FINGERPRINT",
    ] as const)
      assert.throws(
        () => configuredPrivacyVault({ ...configured, [key]: undefined }),
        AccountErasureUnavailable,
      );
    assert.throws(
      () => privacyVaultWatermark(configuredPrivacyVault(configured)),
      AccountErasureUnavailable,
    );
    assert.equal(existsSync(directory), false);
  }));
test("only explicit initialization establishes a usable pinned authority; a different empty vault cannot substitute", () =>
  fixture((root, env) => {
    const first = initializePrivacyVault(path.join(root, "first"));
    const second = initializePrivacyVault(path.join(root, "second"));
    const configured = {
      ...env,
      REELCHEMY_PRIVACY_DIR: first.directory,
      REELCHEMY_PRIVACY_ID: first.id,
      REELCHEMY_PRIVACY_KEY_FINGERPRINT: first.keyFingerprint,
    };
    assert.equal(
      privacyVaultWatermark(configuredPrivacyVault(configured)).sequence,
      0,
    );
    assert.throws(
      () =>
        privacyVaultWatermark(
          configuredPrivacyVault({
            ...configured,
            REELCHEMY_PRIVACY_DIR: second.directory,
          }),
        ),
      AccountErasureUnavailable,
    );
  }));
