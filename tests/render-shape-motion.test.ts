import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { blankTimeline } from "../src/lib/editor";
import { timelineSchema } from "../src/lib/schema";

// Decode one RGB pixel of an exported frame.
function pixel(video: string, frame: number, x: number, y: number) {
  const raw = execFileSync(
    "ffmpeg",
    [
      "-v",
      "error",
      "-i",
      video,
      "-vf",
      `select=eq(n\\,${frame}),format=rgb24,crop=1:1:${x}:${y}`,
      "-frames:v",
      "1",
      "-f",
      "rawvideo",
      "-pix_fmt",
      "rgb24",
      "-",
    ],
    { timeout: 20000 },
  );
  return [...raw.subarray(0, 3)];
}
const bright = (rgb: number[]) => rgb.every((v) => v > 200);
const dark = (rgb: number[]) => rgb.every((v) => v < 60);

test(
  "exports clip masked layers to their shape and apply animated rotation over time",
  { timeout: 120000 },
  async () => {
    const root = await mkdtemp(path.join(tmpdir(), "reelchemy-shape-motion-"));
    process.env.REELCHEMY_DATA_DIR = path.join(root, "data");
    process.env.REELCHEMY_RENDER_CACHE_DIR = path.join(root, "cache");
    try {
      const { renderFilm } = await import("../src/lib/render");
      const timeline = blankTimeline({
        prompt: "Shapes",
        duration: 5,
        format: "square",
      });
      const scene = timeline.scenes[0],
        base = scene.layers[0];
      scene.durationFrames = 60;
      scene.background = "#000000";
      scene.transition = "cut";
      scene.layers = [
        // A white square masked to a circle: its corners must stay black.
        {
          ...base,
          id: "disc",
          kind: "rectangle",
          text: "",
          x: 0.05,
          y: 0.3,
          width: 0.4,
          height: 0.4,
          color: "#ffffff",
          animation: "none",
          mask: "circle",
        },
        // A thin white bar turning 90° over the scene: horizontal at the
        // start, vertical at the end.
        {
          ...base,
          id: "bar",
          kind: "rectangle",
          text: "",
          x: 0.55,
          y: 0.48,
          width: 0.4,
          height: 0.04,
          color: "#ffffff",
          animation: "none",
          keyframes: [
            { frame: 0, x: 0, y: 0, scale: 1, opacity: 1, rotation: 0 },
            { frame: 59, x: 0, y: 0, scale: 1, opacity: 1, rotation: 90 },
          ],
        },
      ];
      const output = path.join(root, "export");
      await renderFilm(timelineSchema.parse(timeline), output);
      const video = path.join(output, "video.mp4");
      const size = 1080; // standard square export
      const at = (fx: number, fy: number): [number, number] => [
        Math.round(fx * size),
        Math.round(fy * size),
      ];
      // Disc: centre lit, box corner clipped away.
      assert(bright(pixel(video, 30, ...at(0.25, 0.5))), "disc centre");
      assert(dark(pixel(video, 30, ...at(0.065, 0.315))), "disc corner");
      // Bar: at frame 0 a point on its horizontal arm is lit and a point
      // above its centre is not; at the end the reverse.
      const arm = at(0.62, 0.5),
        above = at(0.75, 0.36);
      assert(bright(pixel(video, 0, ...arm)), "horizontal arm at start");
      assert(dark(pixel(video, 0, ...above)), "nothing above at start");
      assert(dark(pixel(video, 59, ...arm)), "arm turned away at end");
      assert(bright(pixel(video, 59, ...above)), "vertical bar at end");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);
