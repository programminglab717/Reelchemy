import type { APIRequestContext } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
// Decode the actual downloaded MP4 independently of the review-image pipeline,
// so browser assertions also verify the encoded/cache output directly.
export async function encodedFrame(
  request: APIRequestContext,
  jobId: string,
  seconds: number,
) {
  const response = await request.get(`/api/jobs/${jobId}/download`);
  if (!response.ok())
    throw new Error(`MP4 download returned HTTP ${response.status()}.`);
  const bytes = await response.body();
  if (bytes.length > 50 * 1024 * 1024)
    throw new Error("Test MP4 exceeds its byte bound.");
  const dir = await mkdtemp(path.join(tmpdir(), "reelchemy-encoded-frame-"));
  try {
    const file = path.join(dir, "video.mp4");
    await writeFile(file, bytes, { mode: 0o600 });
    const meta = JSON.parse(
      execFileSync(
        "ffprobe",
        [
          "-v",
          "error",
          "-select_streams",
          "v:0",
          "-show_entries",
          "stream=width,height",
          "-of",
          "json",
          file,
        ],
        { encoding: "utf8", timeout: 15000 },
      ),
    );
    const { width, height } = meta.streams[0] as {
      width: number;
      height: number;
    };
    if (
      !Number.isInteger(width) ||
      !Number.isInteger(height) ||
      width < 1 ||
      height < 1 ||
      width * height > 8300000
    )
      throw new Error("Invalid test frame geometry.");
    const data = execFileSync(
      "ffmpeg",
      [
        "-v",
        "error",
        "-ss",
        String(seconds),
        "-i",
        file,
        "-frames:v",
        "1",
        "-f",
        "rawvideo",
        "-pix_fmt",
        "rgb24",
        "pipe:1",
      ],
      { maxBuffer: 30 * 1024 * 1024, timeout: 30000 },
    );
    if (data.length !== width * height * 3)
      throw new Error("Encoded frame decode returned unexpected bytes.");
    return { data, width, height, channels: 3 };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
