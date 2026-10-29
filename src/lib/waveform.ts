import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { assetDir, validAssetId } from "./assets";
import { runCommand } from "./process";
import { pcmPeaks, type Waveform } from "./waveform-math";
const cache = new Map<string, Waveform>(),
  active = new Map<string, Promise<Waveform>>();
export class WaveformBusy extends Error {}
export function readWaveform(id: string): Promise<Waveform> {
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
    try {
      const file = path.join(dir, "samples.pcm");
      await runCommand(
        "ffmpeg",
        [
          "-v",
          "error",
          "-protocol_whitelist",
          "file,pipe",
          "-i",
          path.join(assetDir, id),
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
        { timeoutMs: 20000 },
      );
      const bytes = await readFile(file);
      if (bytes.length > 120 * 8000 * 2 || bytes.length % 2)
        throw new Error("Waveform exceeded its sample limit.");
      const samples = new Int16Array(bytes.length / 2);
      for (let i = 0; i < samples.length; i++)
        samples[i] = bytes.readInt16LE(i * 2);
      const result = pcmPeaks(samples, 8000);
      if (cache.size >= 64) cache.delete(cache.keys().next().value!);
      cache.set(id, result);
      return result;
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  })();
  active.set(id, work);
  void work.finally(() => active.delete(id)).catch(() => {});
  return work;
}
