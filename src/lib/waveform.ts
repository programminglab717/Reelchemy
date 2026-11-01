import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { validAssetId } from "./project-assets";
import { constants, openSync, closeSync, fstatSync } from "node:fs";
import { withPrivateDirectory } from "./private-directory";
import {
  assertNormalizationActive,
  type MediaNormalizationOptions,
} from "./media-normalization";
import { runCommand } from "./process";
import { pcmPeaks, type Waveform } from "./waveform-math";
const cache = new Map<string, Waveform>(),
  active = new Map<string, Promise<Waveform>>();
export class WaveformBusy extends Error {}
export function readWaveform(
  id: string,
  options: MediaNormalizationOptions = {},
): Promise<Waveform> {
  assertNormalizationActive(options);
  if (!validAssetId(id))
    return Promise.reject(new Error("Invalid media asset."));
  const cached = cache.get(id);
  if (cached) return Promise.resolve(cached);
  const existing = active.get(id);
  if (existing) return existing;
  if (active.size >= 2)
    return Promise.reject(
      new WaveformBusy("Waveform service is busy. Try again shortly."),
    );
  const work = (async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "reelchemy-waveform-"));
    let descriptor: number | undefined;
    try {
      const root = path.resolve(process.env.REELCHEMY_DATA_DIR || ".data");
      descriptor = withPrivateDirectory(root, "assets", (anchor) =>
        openSync(
          path.join(anchor, id),
          constants.O_RDONLY | constants.O_NOFOLLOW,
        ),
      );
      if (!fstatSync(descriptor).isFile())
        throw new Error("Invalid waveform media.");
      const source =
        process.platform === "linux"
          ? `/proc/${process.pid}/fd/${descriptor}`
          : path.join(root, "assets", id);
      const file = path.join(dir, "samples.pcm");
      await runCommand(
        "ffmpeg",
        [
          "-v",
          "error",
          "-protocol_whitelist",
          "file,pipe",
          "-i",
          source,
          "-map",
          "0:a:0",
          "-vn",
          "-t",
          "120",
          "-af",
          "aresample=async=1:first_pts=0",
          "-ar",
          "8000",
          "-ac",
          "1",
          "-f",
          "s16le",
          file,
        ],
        { timeoutMs: 20000, cancelled: options.cancelled },
      );
      const bytes = await readFile(file);
      if (bytes.length > 120 * 8000 * 2 || bytes.length % 2)
        throw new Error("Waveform exceeded its sample limit.");
      const samples = new Int16Array(bytes.length / 2);
      for (let i = 0; i < samples.length; i++)
        samples[i] = bytes.readInt16LE(i * 2);
      const result = pcmPeaks(samples, 8000);
      assertNormalizationActive(options);
      if (cache.size >= 64) cache.delete(cache.keys().next().value!);
      cache.set(id, result);
      return result;
    } finally {
      if (descriptor !== undefined) closeSync(descriptor);
      await rm(dir, { recursive: true, force: true });
    }
  })();
  active.set(id, work);
  void work.finally(() => active.delete(id)).catch(() => {});
  return work;
}
