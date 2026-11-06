import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { blankTimeline } from "../src/lib/editor";
import { timelineSchema } from "../src/lib/schema";

// Asset and cache paths are fixed when the modules first load.
const root = await mkdtemp(path.join(tmpdir(), "reelchemy-font-render-"));
process.env.REELCHEMY_DATA_DIR = path.join(root, "data");
process.env.REELCHEMY_RENDER_CACHE_DIR = path.join(root, "cache");
after(() => rm(root, { recursive: true, force: true }));

// Rightmost lit column of a horizontal band in one exported frame.
function extent(video: string, frame: number, y: number, h: number) {
  const width = 1080;
  const raw = execFileSync(
    "ffmpeg",
    [
      "-v",
      "error",
      "-i",
      video,
      "-vf",
      `select=eq(n\\,${frame}),format=gray,crop=${width}:${h}:0:${y}`,
      "-frames:v",
      "1",
      "-f",
      "rawvideo",
      "-pix_fmt",
      "gray",
      "-",
    ],
    { timeout: 20000 },
  );
  let right = -1;
  for (let row = 0; row < h; row++)
    for (let x = 0; x < width; x++)
      if (raw[row * width + x] > 160) right = Math.max(right, x);
  return right;
}

test(
  "exports draw text in an uploaded brand font",
  { timeout: 120000 },
  async () => {
    {
      const { renderFilm } = await import("../src/lib/render");
      const { storeFont } = await import("../src/lib/fonts");
      const require = createRequire(import.meta.url);
      const font = await storeFont(
        await readFile(
          path.join(
            path.dirname(require.resolve("next/package.json")),
            "dist/next-devtools/server/font/geist-mono-latin.woff2",
          ),
        ),
        "Geist Mono.woff2",
        "OFL 1.1",
      );
      const timeline = blankTimeline({
        prompt: "Fonts",
        duration: 5,
        format: "square",
      });
      const scene = timeline.scenes[0],
        base = scene.layers[0];
      scene.durationFrames = 30;
      scene.background = "#000000";
      scene.transition = "cut";
      // The same narrow letters: a monospaced face spreads them much wider
      // than the proportional fallback.
      const line = (id: string, y: number, fontAssetId?: string) => ({
        ...base,
        id,
        kind: "text" as const,
        text: "llllllllll",
        x: 0.05,
        y,
        width: 0.9,
        height: 0.1,
        color: "#ffffff",
        fontSize: 48,
        fontFamily: "sans" as const,
        textAlign: "left" as const,
        animation: "none" as const,
        ...(fontAssetId ? { fontAssetId } : {}),
      });
      scene.layers = [line("brand", 0.1, font.id), line("plain", 0.5)];
      const output = path.join(root, "export");
      await renderFilm(timelineSchema.parse(timeline), output);
      const video = path.join(output, "video.mp4");
      const brand = extent(video, 15, 108, 108),
        plain = extent(video, 15, 540, 108);
      assert(plain > 54, `fallback text drawn (${plain})`);
      assert(
        brand > plain + 60,
        `brand font wider than fallback (${brand} vs ${plain})`,
      );
    }
  },
);

test(
  "exports refuse a font Chromium cannot load instead of silently falling back",
  { timeout: 120000 },
  async () => {
    {
      const { renderFilm } = await import("../src/lib/render");
      const { storeFont } = await import("../src/lib/fonts");
      const { RenderQCError } = await import("../src/lib/layout-qc");
      // A well-formed table directory whose tables are garbage: admitted by
      // the structural check, rejected by Chromium's font sanitizer.
      const tags = ["cmap", "glyf", "head", "name"];
      const bytes = Buffer.alloc(12 + tags.length * 16 + tags.length * 4);
      bytes.writeUInt32BE(0x00010000, 0);
      bytes.writeUInt16BE(tags.length, 4);
      tags.forEach((tag, i) => {
        bytes.write(tag, 12 + i * 16, "latin1");
        bytes.writeUInt32BE(12 + tags.length * 16 + i * 4, 12 + i * 16 + 8);
        bytes.writeUInt32BE(4, 12 + i * 16 + 12);
      });
      const font = await storeFont(bytes, "Broken.ttf", "Mine");
      const timeline = blankTimeline({
        prompt: "Fonts",
        duration: 5,
        format: "square",
      });
      timeline.scenes[0].layers[0] = {
        ...timeline.scenes[0].layers[0],
        kind: "text",
        text: "Hello",
        fontAssetId: font.id,
      };
      await assert.rejects(
        renderFilm(timelineSchema.parse(timeline), path.join(root, "export")),
        (error) =>
          error instanceof RenderQCError &&
          /could not be loaded/.test(error.message),
      );
    }
  },
);
