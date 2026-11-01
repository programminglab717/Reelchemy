import { randomUUID } from "node:crypto";
import {
  constants,
  openSync,
  closeSync,
  unlinkSync,
  writeFileSync,
  fsyncSync,
} from "node:fs";
import path from "node:path";
import { z } from "zod";
import { CommandCancelledError } from "./process";
import { withPrivateDirectory } from "./private-directory";

export type MediaNormalizationOptions = {
  id?: string;
  cancelled?: () => boolean;
};
export function assertNormalizationActive(options: MediaNormalizationOptions) {
  if (options.cancelled?.()) throw new CommandCancelledError();
}
export function normalizationId(options: MediaNormalizationOptions) {
  assertNormalizationActive(options);
  return z.uuid().parse(options.id ?? randomUUID());
}
export function writeNormalizedMedia(
  id: string,
  bytes: Uint8Array,
  options: MediaNormalizationOptions,
) {
  z.uuid().parse(id);
  assertNormalizationActive(options);
  return withPrivateDirectory(
    path.resolve(process.env.REELCHEMY_DATA_DIR || ".data"),
    "assets",
    (anchor) => {
      const file = path.join(anchor, id);
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
        assertNormalizationActive(options);
      } catch (error) {
        unlinkSync(file);
        throw error;
      } finally {
        closeSync(descriptor);
      }
    },
  );
}
