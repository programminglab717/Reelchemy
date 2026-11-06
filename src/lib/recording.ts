import { MAX_SOURCE_SECONDS } from "./timeline-limits";
// PCM WAV keeps recordings interoperable without depending on browser-specific
// MediaRecorder containers or missing duration metadata in streamed WebM files.
export function encodeRecording(chunks: Float32Array[], sampleRate: number) {
  const frames = chunks.reduce((n, c) => n + c.length, 0);
  if (
    !Number.isInteger(sampleRate) ||
    sampleRate < 8000 ||
    sampleRate > 96000 ||
    frames < sampleRate / 10 ||
    frames > sampleRate * MAX_SOURCE_SECONDS ||
    frames * 2 + 44 > 60 * 1024 * 1024
  )
    throw new Error("Record between 0.1 seconds and 5 minutes, up to 60 MB.");
  const bytes = new ArrayBuffer(44 + frames * 2),
    view = new DataView(bytes);
  const text = (offset: number, value: string) =>
    [...value].forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)));
  text(0, "RIFF");
  view.setUint32(4, 36 + frames * 2, true);
  text(8, "WAVE");
  text(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, "data");
  view.setUint32(40, frames * 2, true);
  let offset = 44;
  for (const chunk of chunks)
    for (const sample of chunk) {
      const value = Number.isFinite(sample)
        ? Math.max(-1, Math.min(1, sample))
        : 0;
      view.setInt16(
        offset,
        Math.round(value * (value < 0 ? 32768 : 32767)),
        true,
      );
      offset += 2;
    }
  return bytes;
}
