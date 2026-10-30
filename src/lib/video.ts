import {
  mkdtemp,
  writeFile,
  readFile,
  rm,
  mkdir,
  stat,
} from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { probeMedia } from "./audio";
import { runCommand } from "./process";
import { assetDir } from "./assets";
import type { Asset } from "./schema";
export const MAX_VIDEO_BYTES = 25 * 1024 * 1024;
export async function storeVideo(
  bytes: Buffer,
  name: string,
  license: string,
): Promise<Asset> {
  if (bytes.length > MAX_VIDEO_BYTES)
    throw new Error("Video files must be 25 MB or smaller.");
  const dir = await mkdtemp(path.join(tmpdir(), "reelchemy-video-"));
  try {
    const input = path.join(dir, "input"),
      output = path.join(dir, "normalized.mp4");
    await writeFile(input, bytes);
    const meta = probeMedia(input);
    const streams = meta.streams.filter(
      (s: { codec_type: string }) => s.codec_type === "video",
    );
    const video = streams[0],
      duration = Number(video?.duration || meta.format.duration);
    const rate = String(video?.avg_frame_rate || "0/1")
      .split("/")
      .map(Number);
    const fps = rate[0] / (rate[1] || 1);
    if (
      !/^(mov,mp4,m4a,3gp,3g2,mj2|matroska,webm)$/.test(
        meta.format.format_name,
      ) ||
      streams.length !== 1 ||
      !["h264", "hevc", "vp8", "vp9", "av1"].includes(video?.codec_name) ||
      video.disposition?.attached_pic ||
      !Number.isFinite(duration) ||
      duration <= 0 ||
      duration > 120 ||
      !Number.isFinite(fps) ||
      fps <= 0 ||
      fps > 120 ||
      video.width * video.height > 8388608 ||
      video.width < 2 ||
      video.height < 2
    )
      throw new Error(
        "Use an MP4, MOV or WebM clip up to 120 seconds, 8.3 megapixels and 120 fps (H.264, HEVC, VP8, VP9 or AV1).",
      );
    const hasAudio = meta.streams.some(
      (s: { codec_type: string }) => s.codec_type === "audio",
    );
    await runCommand(
      "ffmpeg",
      [
        "-v",
        "error",
        "-threads",
        "2",
        "-protocol_whitelist",
        "file,pipe",
        "-i",
        input,
        "-map",
        "0:v:0",
        "-map",
        "0:a:0?",
        "-sn",
        "-dn",
        "-map_metadata",
        "-1",
        "-map_chapters",
        "-1",
        "-vf",
        "scale=w='min(1920,iw)':h='min(1080,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2,fps=30,setsar=1",
        "-c:v",
        "libx264",
        "-threads",
        "2",
        "-preset",
        "fast",
        "-crf",
        "23",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        "-ar",
        "48000",
        "-ac",
        "2",
        "-b:a",
        "128k",
        "-t",
        "120",
        "-fs",
        String(MAX_VIDEO_BYTES + 1024 * 1024),
        "-movflags",
        "+faststart",
        output,
      ],
      { timeoutMs: 120000 },
    );
    const outputBytes = (await stat(output)).size;
    if (outputBytes > MAX_VIDEO_BYTES)
      throw new Error(
        "Normalized video exceeds 25 MB. Trim or compress the clip first.",
      );
    const clean = probeMedia(output),
      v = clean.streams.find(
        (s: { codec_type: string }) => s.codec_type === "video",
      );
    const frames = Number(v?.nb_frames);
    if (
      v?.codec_name !== "h264" ||
      v?.r_frame_rate !== "30/1" ||
      !Number.isInteger(frames) ||
      frames < 1 ||
      frames > 3600 ||
      Math.abs(frames / 30 - duration) > 0.1
    )
      throw new Error(
        "Video normalization could not preserve the source duration.",
      );
    await runCommand(
      "ffmpeg",
      [
        "-v",
        "error",
        "-xerror",
        "-threads",
        "2",
        "-protocol_whitelist",
        "file,pipe",
        "-i",
        output,
        "-f",
        "null",
        "-",
      ],
      { timeoutMs: 120000 },
    );
    const id = randomUUID();
    await mkdir(assetDir, { recursive: true });
    await writeFile(path.join(assetDir, id), await readFile(output), {
      flag: "wx",
    });
    return {
      id,
      bytes: outputBytes,
      name:
        path
          .basename(name)
          .replace(/[^a-zA-Z0-9._ -]/g, "_")
          .slice(0, 100) || "Video",
      source: "User upload",
      license,
      mime: "video/mp4",
      durationFrames: frames,
      width: v.width,
      height: v.height,
      hasAudio,
      createdAt: new Date().toISOString(),
    };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
