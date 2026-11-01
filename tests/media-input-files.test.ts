import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  readFileSync,
  writeFileSync,
  lstatSync,
  mkdirSync,
  renameSync,
  symlinkSync,
  rmSync,
  readdirSync,
} from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { createHash, randomUUID } from "node:crypto";
import { MediaInputFiles } from "../src/lib/media-input-files";
import { withPrivateDirectory } from "../src/lib/private-directory";
import { writeNormalizedMedia } from "../src/lib/media-normalization";
import { CommandCancelledError } from "../src/lib/process";

test("private input files validate size/digest/identity, persist and refuse replacement", () => {
  const root = mkdtempSync(path.join(tmpdir(), "reelchemy-input-files-"));
  try {
    const spool = new MediaInputFiles(root),
      id = randomUUID();
    const bytes = Buffer.from("Synthetic private raw media"),
      hash = createHash("sha256").update(bytes).digest("hex");
    assert.throws(() => spool.write(id, bytes, bytes.length - 1, hash));
    assert.throws(() => spool.write(id, bytes, bytes.length, "0".repeat(64)));
    assert.throws(() => spool.write("../../secret", bytes, bytes.length, hash));
    spool.write(id, bytes, bytes.length, hash);
    assert.equal(
      lstatSync(path.join(root, "media-inputs", `${id}.input`)).mode & 0o777,
      0o600,
    );
    assert.deepEqual(spool.read(id, bytes.length, bytes.length, hash), bytes);
    assert.throws(() => spool.write(id, bytes, bytes.length, hash), /EEXIST/);
    assert.throws(() => spool.read(id, bytes.length - 1, bytes.length, hash));
    assert.throws(() => spool.read(id, bytes.length, bytes.length - 1, hash));
    assert.throws(() =>
      spool.read(id, bytes.length, bytes.length, "0".repeat(64)),
    );
    writeFileSync(
      path.join(root, "media-inputs", `${id}.input`),
      "Tampered input",
    );
    assert.throws(() => spool.read(id, bytes.length, bytes.length, hash));
    spool.remove(id);
    spool.remove(id);
    assert.deepEqual(readdirSync(path.join(root, "media-inputs")), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("raw-file and spool-parent symlinks cannot read, overwrite or erase another directory", () => {
  const root = mkdtempSync(path.join(tmpdir(), "reelchemy-input-links-"));
  try {
    const canaries = path.join(root, "canaries");
    mkdirSync(canaries);
    const secret = path.join(canaries, "private.txt"),
      bytes = Buffer.from("Canary must survive"),
      hash = createHash("sha256").update(bytes).digest("hex");
    writeFileSync(secret, bytes);
    const data = path.join(root, "data"),
      spool = new MediaInputFiles(data),
      id = randomUUID();
    spool.remove(id); // Initialize the private directory.
    const input = path.join(data, "media-inputs", `${id}.input`);
    symlinkSync(secret, input);
    assert.throws(() => spool.read(id, 1000, bytes.length, hash));
    assert.throws(() => spool.write(id, bytes, 1000, hash));
    spool.remove(id);
    assert.deepEqual(readFileSync(secret), bytes);
    rmSync(path.join(data, "media-inputs"), { recursive: true });
    symlinkSync(canaries, path.join(data, "media-inputs"));
    for (const operation of [
      () => spool.remove(id),
      () => spool.write(id, bytes, 1000, hash),
      () => spool.read(id, 1000, bytes.length, hash),
    ])
      assert.throws(operation);
    assert.deepEqual(readFileSync(secret), bytes);
    assert.deepEqual(readdirSync(canaries), ["private.txt"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a Linux directory anchor survives a renamed parent and a replacement symlink", () => {
  const root = mkdtempSync(path.join(tmpdir(), "reelchemy-input-anchor-"));
  try {
    const data = path.join(root, "data"),
      outside = path.join(root, "outside");
    mkdirSync(outside);
    writeFileSync(path.join(outside, "owned.txt"), "Canary");
    withPrivateDirectory(data, "media-inputs", (anchor) => {
      writeFileSync(path.join(anchor, "owned.txt"), "Actual private data");
      renameSync(path.join(data, "media-inputs"), path.join(data, "original"));
      symlinkSync(outside, path.join(data, "media-inputs"));
      assert.equal(
        readFileSync(path.join(anchor, "owned.txt"), "utf8"),
        "Actual private data",
      );
      writeFileSync(path.join(anchor, "owned.txt"), "Safe updated data");
    });
    assert.equal(
      readFileSync(path.join(outside, "owned.txt"), "utf8"),
      "Canary",
    );
    assert.equal(
      readFileSync(path.join(data, "original", "owned.txt"), "utf8"),
      "Safe updated data",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("preallocated normalized outputs are exclusive, private and removed if cancellation wins", () => {
  const previous = process.env.REELCHEMY_DATA_DIR;
  const root = mkdtempSync(path.join(tmpdir(), "reelchemy-normalized-output-"));
  process.env.REELCHEMY_DATA_DIR = root;
  try {
    const id = randomUUID(),
      bytes = Buffer.from("Synthetic normalized media");
    writeNormalizedMedia(id, bytes, {});
    const file = path.join(root, "assets", id);
    assert.equal(lstatSync(file).mode & 0o777, 0o600);
    assert.deepEqual(readFileSync(file), bytes);
    assert.throws(
      () => writeNormalizedMedia(id, Buffer.from("Replacement"), {}),
      /EEXIST/,
    );
    assert.deepEqual(readFileSync(file), bytes);
    let calls = 0;
    const cancelled = randomUUID();
    assert.throws(
      () =>
        writeNormalizedMedia(cancelled, bytes, {
          cancelled: () => ++calls > 1,
        }),
      CommandCancelledError,
    );
    assert.equal(calls, 2);
    assert.deepEqual(readdirSync(path.join(root, "assets")), [id]);
    assert.throws(() => writeNormalizedMedia("../other", bytes, {}));
  } finally {
    if (previous === undefined) delete process.env.REELCHEMY_DATA_DIR;
    else process.env.REELCHEMY_DATA_DIR = previous;
    rmSync(root, { recursive: true, force: true });
  }
});
