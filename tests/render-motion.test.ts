import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { blankTimeline } from "../src/lib/editor";
import { timelineSchema } from "../src/lib/schema";

const root = await mkdtemp(path.join(tmpdir(), "reelchemy-motion-render-"));
process.env.REELCHEMY_DATA_DIR = path.join(root, "data");
process.env.REELCHEMY_RENDER_CACHE_DIR = path.join(root, "cache");
after(() => rm(root, { recursive: true, force: true }));

// Average brightness of a small square around (x, y) in one exported frame.
function brightness(video: string, frame: number, x: number, y: number) {
  const raw = execFileSync(
    "ffmpeg",
    [
      "-v",
      "error",
      "-i",
      video,
      "-vf",
      `select=eq(n\\,${frame}),format=gray,crop=6:6:${x - 3}:${y - 3}`,
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
  return raw.reduce((sum, value) => sum + value, 0) / raw.length;
}

test(
  "a code scene renders GSAP timelines and animation-frame loops at their exact frame",
  { timeout: 240000 },
  async () => {
    const { renderFilm } = await import("../src/lib/render");
    const timeline = blankTimeline({
      prompt: "Code scene",
      duration: 5,
      format: "landscape",
    });
    timeline.scenes = [
      {
        ...timeline.scenes[0],
        id: "motion",
        durationFrames: 60,
        transition: "cut",
        layers: [],
        code: {
          html: '<div id="box"></div><div id="ball"></div>',
          css: "#stage{background:#000}#box{position:absolute;left:100px;top:100px;width:200px;height:200px;background:#fff}#ball{position:absolute;left:100px;top:700px;width:60px;height:60px;background:#fff}",
          // The box follows a 2-second linear GSAP tween; the ball moves 25px
          // per animation frame, so it is only right if every frame step ran
          // exactly once, whichever browser tab rendered the frame.
          js: `gsap.to("#box", { x: 1520, duration: 2, ease: "none" });
let ticks = 0;
const ball = document.getElementById("ball");
requestAnimationFrame(function step() {
  ticks++;
  ball.style.left = 100 + 25 * ticks + "px";
  requestAnimationFrame(step);
});`,
        },
      },
    ];
    const output = path.join(root, "export");
    await renderFilm(timelineSchema.parse(timeline), output);
    const video = path.join(output, "video.mp4");
    // Output is 1280×720: stage coordinates scale by 2/3.
    const at = (stage: number) => Math.round((stage * 2) / 3);
    for (const frame of [0, 15, 30, 59]) {
      const box = 100 + 1520 * (frame / 60) + 100;
      assert(
        brightness(video, frame, at(box), at(200)) > 200,
        `box centre lit at frame ${frame}`,
      );
      assert(
        brightness(video, frame, at(box + 260), at(200)) < 40,
        `nothing right of the box at frame ${frame}`,
      );
      // The first frame is painted before any animation frame runs.
      const ball = 100 + 25 * frame + 30;
      assert(
        brightness(video, frame, at(ball), at(730)) > 200,
        `ball centre lit at frame ${frame}`,
      );
      assert(
        brightness(video, frame, at(ball + 120), at(730)) < 40,
        `ball has not run ahead at frame ${frame}`,
      );
    }
  },
);

test(
  "a 3D code scene exports through the renderer with software WebGL",
  { timeout: 300000 },
  async () => {
    const { renderFilm } = await import("../src/lib/render");
    const timeline = blankTimeline({
      prompt: "3D scene",
      duration: 5,
      format: "landscape",
    });
    timeline.scenes = [
      {
        ...timeline.scenes[0],
        id: "depth",
        durationFrames: 30,
        transition: "cut",
        layers: [],
        code: {
          libraries: ["three"],
          html: "",
          css: "#stage{background:#000}",
          // A bright emissive sphere in the centre that slides right.
          js: `const view = R.three({ camera: [0, 0, 8], background: "#000000", environment: false });
const ball = view.sphere({ r: 1.2, color: "#000000", emissive: "#ffffff", emissiveIntensity: 3 });
gsap.to(ball.position, { x: 3, duration: 1, ease: "none" });`,
        },
      },
    ];
    const output = path.join(root, "export-3d");
    await renderFilm(timelineSchema.parse(timeline), output);
    const video = path.join(output, "video.mp4");
    // Frame 0: the sphere fills the centre; by the last frame it has moved right.
    assert(brightness(video, 0, 640, 360) > 200, "sphere drawn at the centre");
    assert(brightness(video, 29, 640, 360) < 60, "the centre is clear later");
    assert(brightness(video, 0, 40, 40) < 30, "the background stays black");
  },
);
