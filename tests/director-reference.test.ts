import { test, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { buildReference } from "../src/director/reference";
import { directFilm } from "../src/director/director";
import type { Llm, LlmPart } from "../src/director/llm";

const folder = await mkdtemp(path.join(tmpdir(), "reelchemy-reference-test-"));
after(() => rm(folder, { recursive: true, force: true }));

test("a reference video becomes a contact sheet with its pacing", async () => {
  // Three 1.5-second shots: red, white, blue (cuts change brightness).
  const video = path.join(folder, "reference.mp4");
  execFileSync("ffmpeg", [
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "color=c=red:s=640x360:d=1.5:r=30",
    "-f",
    "lavfi",
    "-i",
    "color=c=white:s=640x360:d=1.5:r=30",
    "-f",
    "lavfi",
    "-i",
    "color=c=blue:s=640x360:d=1.5:r=30",
    "-filter_complex",
    "[0][1][2]concat=n=3:v=1:a=0",
    "-pix_fmt",
    "yuv420p",
    "-y",
    video,
  ]);
  const reference = await buildReference(video, "video");
  const meta = await sharp(reference.sheet).metadata();
  assert.equal(meta.width, 4 * 480 + 3 * 6);
  assert.equal(meta.height, 2 * 270 + 6);
  assert.match(reference.notes, /4\.5 s long, with 2 cuts/);
  assert.match(reference.notes, /cuts at 1\.5s, 3\.0s/);
  // The first sampled frame is red, the last blue.
  const pixel = async (x: number, y: number) => [
    ...(await sharp(reference.sheet)
      .extract({ left: x, top: y, width: 1, height: 1 })
      .raw()
      .toBuffer()),
  ];
  const [r] = await pixel(100, 100);
  const [, , b] = await pixel(3 * 486 + 100, 276 + 100);
  assert(r > 200 && b > 200);
});

test("a reference image is used as is, scaled down", async () => {
  const file = path.join(folder, "reference.png");
  await writeFile(
    file,
    await sharp({
      create: { width: 2000, height: 1000, channels: 3, background: "#123456" },
    })
      .png()
      .toBuffer(),
  );
  const reference = await buildReference(file, "image");
  assert.equal((await sharp(reference.sheet).metadata()).width, 960);
  assert.match(reference.notes, /reference image/);
});

test(
  "the director shows the reference to the planner and the scene writer",
  { timeout: 120000 },
  async () => {
    const seen: { planner: boolean; images: number; text: string }[] = [];
    const llm: Llm = async ({ system, messages }) => {
      const first = messages[0].content;
      const parts: LlmPart[] =
        typeof first === "string" ? [{ text: first }] : first;
      seen.push({
        planner: system.includes("creative director"),
        images: parts.filter((p) => "png" in p).length,
        text: parts.map((p) => ("text" in p ? p.text : "")).join(""),
      });
      if (system.includes("creative director"))
        return {
          text: JSON.stringify({
            title: "Ref",
            style: {
              background: "#000000",
              surface: "#111111",
              text: "#ffffff",
              muted: "#999999",
              accents: ["#38bdf8"],
              motion: "x",
              motifs: "y",
            },
            scenes: [{ title: "One", seconds: 4, goal: "g", visual: "v" }],
          }),
          truncated: false,
        };
      return {
        text: '<scene><html><div id="t">Hi</div></html><css>#t{position:absolute;left:200px;top:200px;font-size:80px;color:#fff}</css><js>gsap.from("#t",{opacity:0,duration:1});</js></scene>',
        truncated: false,
      };
    };
    const sheet = await sharp({
      create: { width: 64, height: 36, channels: 3, background: "#ff00ff" },
    })
      .png()
      .toBuffer();
    await directFilm({
      brief: { prompt: "Match this", duration: 4, format: "landscape" },
      llm,
      vision: true,
      maxRevisions: 0,
      reference: {
        sheet,
        notes: "A reference video, 9.0 s long, with 3 cuts.",
      },
    });
    const planner = seen.find((s) => s.planner)!;
    const writer = seen.find((s) => !s.planner)!;
    for (const call of [planner, writer]) {
      assert.equal(call.images, 1);
      assert.match(call.text, /STYLE REFERENCE .* 9\.0 s long, with 3 cuts/);
    }
  },
);
