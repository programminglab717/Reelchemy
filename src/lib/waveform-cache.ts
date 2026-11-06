import { MAX_SOURCE_FRAMES } from "./timeline-limits";
import {
  constants,
  openSync,
  closeSync,
  fstatSync,
  fsyncSync,
  readFileSync,
  writeFileSync,
  renameSync,
  unlinkSync,
} from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { withPrivateDirectory } from "./private-directory";
import type { Waveform } from "./waveform-math";
const waveformSchema = z
  .object({
    fps: z.literal(30),
    peaks: z.array(z.number().min(0).max(1)).min(1).max(MAX_SOURCE_FRAMES),
  })
  .strict();
function directory<T>(
  id: string,
  operation: (anchor: string, file: string) => T,
) {
  z.uuid().parse(id);
  return withPrivateDirectory(
    path.resolve(process.env.REELCHEMY_DATA_DIR || ".data"),
    "waveforms",
    (anchor) => operation(anchor, path.join(anchor, `${id}.json`)),
  );
}
export function cachedWaveform(id: string): Waveform | undefined {
  return directory(id, (_anchor, file) => {
    let descriptor: number;
    try {
      descriptor = openSync(
        file,
        constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
    try {
      const stat = fstatSync(descriptor);
      if (!stat.isFile() || stat.size > 65536)
        throw new Error("Invalid waveform cache.");
      return waveformSchema.parse(JSON.parse(readFileSync(descriptor, "utf8")));
    } finally {
      closeSync(descriptor);
    }
  });
}
export function cacheWaveform(id: string, waveform: Waveform) {
  const data = JSON.stringify(waveformSchema.parse(waveform));
  directory(id, (anchor, file) => {
    const temporary = path.join(anchor, `${randomUUID()}.tmp`);
    const descriptor = openSync(
      temporary,
      constants.O_WRONLY |
        constants.O_CREAT |
        constants.O_EXCL |
        constants.O_NOFOLLOW,
      0o600,
    );
    try {
      writeFileSync(descriptor, data);
      fsyncSync(descriptor);
      renameSync(temporary, file);
    } finally {
      closeSync(descriptor);
      try {
        unlinkSync(temporary);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
  });
}
export function removeCachedWaveform(id: string) {
  directory(id, (_anchor, file) => {
    try {
      unlinkSync(file);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  });
}
