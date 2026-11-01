import {
  constants,
  closeSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  openSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
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
