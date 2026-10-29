import { clipAudioTracks } from "./clip-audio";
import { runCommand } from "./process";
import { execFileSync } from "node:child_process";
import {
  mkdtemp,
  mkdir,
  writeFile,
  rm,
  readFile,
  rename,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { assetDir, validAssetId } from "./assets";
import { totalFrames, type Asset, type Timeline } from "./schema";
export function probeMedia(file: string) {
  return JSON.parse(
    execFileSync(
      "ffprobe",
      [
        "-v",
        "error",
        "-protocol_whitelist",
        "file,pipe",
        "-show_streams",
        "-show_format",
        "-of",
        "json",
        file,
      ],
      { encoding: "utf8", timeout: 15000, maxBuffer: 1000000 },
    ),
  );
}
export async function storeAudio(
  bytes: Buffer,
  name: string,
  license: string,
  maxBytes = 10 * 1024 * 1024,
): Promise<Asset> {
  if (bytes.length > maxBytes)
    throw new Error("Audio files must be 10 MB or smaller.");
  const dir = await mkdtemp(path.join(tmpdir(), "reelchemy-audio-"));
  try {
    const input = path.join(dir, "input");
    await writeFile(input, bytes);
    const meta = probeMedia(input),
      duration = Number(meta.format.duration);
    if (
      !["wav", "mp3", "ogg", "flac", "aac"].includes(meta.format.format_name) ||
      meta.streams.some(
        (s: { codec_type: string }) => s.codec_type === "video",
      ) ||
      !Number.isFinite(duration) ||
      duration <= 0 ||
      duration > 120
    )
      throw new Error(
        "Use a WAV, MP3, Ogg, FLAC, or AAC audio-only file up to 120 seconds.",
      );
    const output = path.join(dir, "normalized.wav");
    execFileSync(
      "ffmpeg",
      [
        "-v",
        "error",
        "-protocol_whitelist",
        "file,pipe",
        "-i",
        input,
        "-map",
        "0:a:0",
        "-vn",
        "-map_metadata",
        "-1",
        "-ar",
        "48000",
        "-ac",
        "2",
        "-c:a",
        "pcm_s16le",
        output,
      ],
      { timeout: 30000 },
    );
    const normalized = probeMedia(output);
    const id = randomUUID();
    await mkdir(assetDir, { recursive: true });
    await writeFile(path.join(assetDir, id), await readFile(output), {
      flag: "wx",
    });
    return {
      id,
      name: path
        .basename(name)
        .replace(/[^a-zA-Z0-9._ -]/g, "_")
        .slice(0, 100),
      mime: "audio/wav",
      durationFrames: Math.floor(Number(normalized.format.duration) * 30),
      source: "User upload",
      license,
      createdAt: new Date().toISOString(),
    };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
export async function muxAudio(
  t: Timeline,
  videoPath: string,
  cancelled: () => boolean = () => false,
) {
  const tracks = [...(t.audioTracks || []), ...clipAudioTracks(t)];
  if (tracks.length > 32)
    throw new Error("Use at most 32 audible clips/tracks per export.");
  if (!tracks.length)
    return { tracks: 0, codec: null, peakDb: null, duration: null };
  const inputs: string[] = [],
    filters: string[] = [];
  for (const [i, track] of tracks.entries()) {
    if (!validAssetId(track.assetId)) throw new Error("Invalid audio asset.");
    const input = path.join(assetDir, track.assetId);
    const probe = probeMedia(input);
    if (
      !probe.streams.some(
        (s: { codec_type: string }) => s.codec_type === "audio",
      )
    )
      throw new Error("Audio tracks require audio assets.");
    if (
      track.offsetFrames + track.durationFrames >
      Math.floor(Number(probe.format.duration) * 30) + 1
    )
      throw new Error("Audio trim exceeds the source duration.");
    inputs.push("-i", input);
    const seconds = track.durationFrames / 30,
      fade = track.fadeFrames / 30;
    filters.push(
      `[${i + 1}:a]aresample=async=1:first_pts=0,atrim=start=${track.offsetFrames / 30}:duration=${seconds},asetpts=PTS-STARTPTS,volume=${track.volume},afade=t=in:st=0:d=${fade},afade=t=out:st=${seconds - fade}:d=${fade},adelay=${Math.round((track.startFrame * 1000) / 30)}|${Math.round((track.startFrame * 1000) / 30)}[a${i}]`,
    );
  }
  filters.push(
    `${tracks.map((_, i) => `[a${i}]`).join("")}amix=inputs=${tracks.length}:normalize=0,alimiter=limit=0.95:latency=1,apad,atrim=duration=${totalFrames(t) / 30}[mix]`,
  );
  const output = path.join(path.dirname(videoPath), "muxed.mp4");
  await runCommand(
    "ffmpeg",
    [
      "-v",
      "error",
      "-y",
      "-protocol_whitelist",
      "file,pipe",
      "-i",
      videoPath,
      ...inputs,
      "-filter_complex",
      filters.join(";"),
      "-map",
      "0:v:0",
      "-map",
      "[mix]",
      "-c:v",
      "copy",
      "-c:a",
      "aac",
      "-b:a",
      "192k",
      "-t",
      String(totalFrames(t) / 30),
      "-movflags",
      "+faststart",
      output,
    ],
    { timeoutMs: 60000, cancelled },
  );
  await rename(output, videoPath);
  const probe = probeMedia(videoPath),
    audio = probe.streams.find(
      (s: { codec_type: string }) => s.codec_type === "audio",
    );
  if (
    audio?.codec_name !== "aac" ||
    Math.abs(Number(audio.duration) - totalFrames(t) / 30) > 0.04
  )
    throw new Error("Audio duration/codec verification failed.");
  const stats = await runCommand(
    "ffmpeg",
    [
      "-hide_banner",
      "-i",
      videoPath,
      "-af",
      "volumedetect",
      "-vn",
      "-f",
      "null",
      "-",
    ],
    { timeoutMs: 30000, cancelled },
  );
  const match = stats.stderr?.match(/max_volume:\s*(-?[0-9.]+) dB/);
  const peakDb = match ? Number(match[1]) : null;
  return {
    tracks: tracks.length,
    codec: audio.codec_name,
    peakDb,
    duration: Number(audio.duration),
    note: "Timeline timing, codec and full decode checked. Narration content and perceptual sync require human review.",
  };
}
