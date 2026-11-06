import {
  constants,
  closeSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  openSync,
  readFileSync,
  realpathSync,
  unlinkSync,
  writeFileSync,
  createReadStream,
} from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { z } from "zod";
import { withPrivateDirectory } from "./private-directory";

export class MediaInputFiles {
  constructor(private root: string) {}
  private file<T>(id: string, operation: (file: string) => T) {
    z.uuid().parse(id);
    return withPrivateDirectory(this.root, "media-inputs", (anchor) =>
      operation(path.join(anchor, `${id}.input`)),
    );
  }
  // Call inside the queue's enqueue transaction, after validating its receiver
  // token. This synchronous bounded write cannot race queue expiry or cleanup.
  write(id: string, bytes: Uint8Array, maximum: number, expectedHash: string) {
    if (
      !bytes.length ||
      bytes.length > maximum ||
      createHash("sha256").update(bytes).digest("hex") !== expectedHash
    )
      throw new Error("Invalid private media input.");
    return this.file(id, (file) => {
      const descriptor = openSync(
        file,
        constants.O_WRONLY |
          constants.O_CREAT |
          constants.O_EXCL |
          constants.O_NOFOLLOW,
        0o600,
      );
      try {
        writeFileSync(descriptor, bytes);
        fsyncSync(descriptor);
      } catch (error) {
        unlinkSync(file);
        throw error;
      } finally {
        closeSync(descriptor);
      }
    });
  }
  read(
    id: string,
    maximum: number,
    expectedBytes: number,
    expectedHash: string,
  ) {
    return this.file(id, (file) => {
      const descriptor = openSync(
        file,
        constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
      );
      try {
        const stat = fstatSync(descriptor);
        if (
          !stat.isFile() ||
          stat.size < 1 ||
          stat.size > maximum ||
          stat.size !== expectedBytes
        )
          throw new Error("Invalid private media input.");
        const bytes = readFileSync(descriptor);
        if (
          bytes.length !== expectedBytes ||
          createHash("sha256").update(bytes).digest("hex") !== expectedHash
        )
          throw new Error("Invalid private media input.");
        return bytes;
      } finally {
        closeSync(descriptor);
      }
    });
  }
  // For inputs too large to hold in memory: verifies size and SHA-256 by
  // streaming, and returns the file's real path for native tools (which cannot
  // use this process's directory anchor). `check()` confirms afterwards that
  // the same file is still in place.
  async verifiedPath(
    id: string,
    maximum: number,
    expectedBytes: number,
    expectedHash: string,
  ) {
    const identity = this.file(id, (file) => {
      const descriptor = openSync(
        file,
        constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
      );
      try {
        const stat = fstatSync(descriptor);
        if (
          !stat.isFile() ||
          stat.size < 1 ||
          stat.size > maximum ||
          stat.size !== expectedBytes
        )
          throw new Error("Invalid private media input.");
        return { dev: stat.dev, ino: stat.ino, size: stat.size };
      } finally {
        closeSync(descriptor);
      }
    });
    const real = path.join(
      realpathSync(this.root),
      "media-inputs",
      `${z.uuid().parse(id)}.input`,
    );
    const check = () => {
      const stat = lstatSync(real);
      if (
        !stat.isFile() ||
        stat.dev !== identity.dev ||
        stat.ino !== identity.ino ||
        stat.size !== identity.size
      )
        throw new Error("Invalid private media input.");
    };
    check();
    const hash = createHash("sha256");
    for await (const piece of createReadStream(real, {
      highWaterMark: 1024 * 1024,
    }))
      hash.update(piece as Buffer);
    if (hash.digest("hex") !== expectedHash)
      throw new Error("Invalid private media input.");
    check();
    return { file: real, check };
  }
  remove(id: string) {
    this.file(id, (file) => {
      try {
        const stat = lstatSync(file);
        if (!stat.isFile() && !stat.isSymbolicLink())
          throw new Error("Unexpected private input type.");
        unlinkSync(file); // A symlink entry is removed without following it.
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    });
  }
}
