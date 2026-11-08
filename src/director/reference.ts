import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { runCommand } from "../lib/process";

// A style reference for the director: a contact sheet of frames (shown to
// models that accept images) and notes on its pacing (for every model).
export type DirectorReference = { sheet: Buffer; notes: string };

const FRAMES = 8;
const WIDTH = 480;

export async function buildReference(
  file: string,
  kind: "video" | "image",
  cancelled: () => boolean = () => false,
): Promise<DirectorReference> {
  if (kind === "image")
    return {
      sheet: await sharp(file)
        .resize({ width: 960, height: 960, fit: "inside" })
        .png()
        .toBuffer(),
      notes: "A reference image: match its visual style.",
    };
  const probe = await runCommand(
    "ffprobe",
    ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file],
    { timeoutMs: 20000, cancelled },
  );
  const duration = Number(probe.stdout.trim());
  if (!Number.isFinite(duration) || duration <= 0)
    throw new Error("The reference video could not be read.");
  const folder = await mkdtemp(path.join(tmpdir(), "reelchemy-reference-"));
  try {
    const frames: Buffer[] = [];
    for (let i = 0; i < FRAMES; i++) {
      const out = path.join(folder, `${i}.png`);
      await runCommand(
        "ffmpeg",
        [
          "-v",
          "error",
          "-ss",
          ((duration * (i + 0.5)) / FRAMES).toFixed(3),
          "-i",
          file,
          "-frames:v",
          "1",
          "-vf",
          `scale=${WIDTH}:-2`,
          "-y",
          out,
        ],
        { timeoutMs: 20000, cancelled },
      );
      frames.push(await readFile(out));
    }
    // Shot changes give the reference's rhythm.
    const scenes = await runCommand(
      "ffmpeg",
      [
        "-v",
        "info",
        "-i",
        file,
        "-an",
        "-vf",
        "scale=320:-2,select='gt(scene,0.32)',showinfo",
        "-f",
        "null",
        "-",
      ],
      { timeoutMs: 90000, cancelled, maxOutputBytes: 4000000 },
    );
    const cuts = [...scenes.stderr.matchAll(/pts_time:([\d.]+)/g)]
      .map((m) => Number(m[1]))
      .filter((t) => t > 0.2 && t < duration - 0.2)
      .slice(0, 60);
    const meta = await sharp(frames[0]).metadata();
    const height = meta.height || 270,
      gap = 6,
      columns = 4,
      rows = Math.ceil(frames.length / columns);
    const sheet = await sharp({
      create: {
        width: columns * WIDTH + (columns - 1) * gap,
        height: rows * height + (rows - 1) * gap,
        channels: 3,
        background: "#202020",
      },
    })
      .composite(
        frames.map((input, i) => ({
          input,
          left: (i % columns) * (WIDTH + gap),
          top: Math.floor(i / columns) * (height + gap),
        })),
      )
      .png()
      .toBuffer();
    const shot = duration / (cuts.length + 1);
    return {
      sheet,
      notes:
        `A reference video, ${duration.toFixed(1)} s long, with ${cuts.length} ${cuts.length === 1 ? "cut" : "cuts"} (an average shot of ${shot.toFixed(1)} s)` +
        (cuts.length
          ? `; cuts at ${cuts.map((t) => `${t.toFixed(1)}s`).join(", ")}`
          : "") +
        `. The attached sheet shows ${frames.length} frames sampled evenly, left to right, top to bottom.`,
    };
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
}
