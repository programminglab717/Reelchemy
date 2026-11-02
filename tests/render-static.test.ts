import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readdir, readFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import sharp from "sharp";
import { bundle } from "@remotion/bundler";
import {
  renderMedia,
  selectComposition,
  makeCancelSignal,
} from "@remotion/renderer";
import { blankTimeline } from "../src/lib/editor";
import type { Timeline } from "../src/lib/schema";
import { withRenderBrowser } from "../src/lib/render-browser";
import { renderStaticScene } from "../src/lib/render-static";
import { staticScenePlan } from "../src/lib/static-scene";
import { renderCachedScenes } from "../src/lib/render-cache";

const root = await mkdtemp(path.join(tmpdir(), "reelchemy-static-render-"));
process.env.REELCHEMY_DATA_DIR = path.join(root, "data");
process.env.REELCHEMY_RENDER_CACHE_DIR = path.join(root, "cache");
const { storeImage } = await import("../src/lib/assets");
const { serveRenderAssets } = await import("../src/lib/render-assets");
after(() => rm(root, { recursive: true, force: true }));
function probe(file: string) {
  return JSON.parse(
    execFileSync(
      "ffprobe",
      ["-v", "error", "-show_streams", "-show_format", "-of", "json", file],
      { encoding: "utf8", timeout: 15000 },
    ),
  );
}
function pixels(file: string) {
  return execFileSync(
    "ffmpeg",
    [
      "-v",
      "error",
      "-xerror",
      "-threads",
      "2",
      "-filter_threads",
      "1",
      "-i",
      file,
      "-an",
      "-vf",
      "scale=64:64",
      "-pix_fmt",
      "rgb24",
      "-f",
      "rawvideo",
      "pipe:1",
    ],
    { maxBuffer: 8 * 1024 * 1024, timeout: 30000 },
  );
}

test(
  "static reuse matches real baseline pixels/timing in every format and cleans captures on cancellation",
  // Three baseline/optimized pairs at full output size can exceed two minutes
  // on the constrained verification host, even without another test running.
  { timeout: 240000 },
  async (t) => {
    const asset = await storeImage(
      await sharp({
        create: { width: 96, height: 64, channels: 3, background: "#e8a530" },
      })
        .png()
        .toBuffer(),
      "Synthetic static badge.png",
      "Generated private test fixture",
    );
    const serveUrl = await bundle({
      entryPoint: path.resolve("src/video/index.tsx"),
    });
    const browserExecutable = process.env.CHROMIUM_PATH || "/usr/bin/chromium";
    await withRenderBrowser(browserExecutable, async (puppeteerInstance) => {
      for (const format of ["landscape", "portrait", "square"] as const) {
        await t.test(
          `pixel/color/frame parity and caption boundaries: ${format}`,
          async () => {
            const timeline = blankTimeline({
              prompt: "Static parity",
              duration: 5,
              format,
            });
            const base = timeline.scenes[0].layers[0];
            timeline.scenes[0].layers = [
              {
                ...base,
                id: "background",
                kind: "gradient",
                x: 0.04,
                y: 0.04,
                width: 0.92,
                height: 0.85,
                color: "#2456a3",
              },
              {
                ...base,
                id: "image",
                kind: "image",
                assetId: asset.id,
                x: 0.65,
                y: 0.16,
                width: 0.2,
                height: 0.18,
                rotation: 18,
              },
              {
                ...base,
                id: "arrow",
                kind: "arrow",
                x: 0.12,
                y: 0.16,
                width: 0.35,
                height: 0.18,
                color: "#e8a530",
              },
              {
                ...base,
                text: "Static frame parity",
                fontSize: 38,
                fontFamily: "serif",
                textAlign: "center",
                width: 0.8,
              },
            ];
            timeline.captions = [
              {
                id: "first",
                text: "First caption",
                startFrame: 0,
                endFrame: 30,
              },
              {
                id: "second",
                text: "Second caption",
                startFrame: 60,
                endFrame: 90,
              },
              {
                id: "third",
                text: "Last caption",
                startFrame: 105,
                endFrame: 150,
              },
            ];
            const media = await serveRenderAssets(timeline);
            try {
              const plan = staticScenePlan(timeline)!;
              assert(plan);
              const common = {
                timeline,
                serveUrl,
                assetSources: media.sources,
                browserExecutable,
                puppeteerInstance,
                cancelSignal: makeCancelSignal().cancelSignal,
                isCancelled: () => false,
                onProgress: () => {},
              };
              const composition = await selectComposition({
                ...common,
                id: "Reelchemy",
                inputProps: { timeline, assetSources: media.sources },
              });
              const baseline = path.join(root, `baseline-${format}.mp4`);
              await renderMedia({
                ...common,
                composition,
                inputProps: { timeline, assetSources: media.sources },
                outputLocation: baseline,
                codec: "h264",
                pixelFormat: "yuv420p",
                muted: true,
                concurrency: 2,
              });
              const optimized = path.join(root, `optimized-${format}.mp4`);
              if (format === "landscape") {
                const namespace = randomUUID();
                const result = await renderCachedScenes({
                  ...common,
                  namespace,
                  outputLocation: optimized,
                });
                assert.equal(result[0].reused, false);
                assert.deepEqual(result[0].frameReuse, {
                  captured: 5,
                  total: 150,
                });
                const again = path.join(root, "cached.mp4");
                const hit = await renderCachedScenes({
                  ...common,
                  namespace,
                  outputLocation: again,
                });
                assert.equal(hit[0].reused, true);
                const digest = (bytes: Buffer) =>
                  createHash("sha256").update(bytes).digest("hex");
                assert.equal(
                  digest(await readFile(again)),
                  digest(await readFile(optimized)),
                );
              } else
                await renderStaticScene({
                  ...common,
                  plan,
                  composition,
                  outputLocation: optimized,
                });
              const before = probe(baseline),
                after = probe(optimized);
              const original = before.streams.find(
                (s: { codec_type: string }) => s.codec_type === "video",
              );
              const output = after.streams.find(
                (s: { codec_type: string }) => s.codec_type === "video",
              );
              for (const field of [
                "codec_name",
                "profile",
                "width",
                "height",
                "r_frame_rate",
                "time_base",
                "color_range",
                "color_space",
                "nb_frames",
              ])
                assert.equal(output[field], original[field], field);
              assert.equal(Number(output.nb_frames), 150);
              assert.equal(Number(after.format.duration), 5);
              const a = pixels(baseline),
                b = pixels(optimized);
              assert.equal(a.length, 150 * 64 * 64 * 3);
              assert.equal(b.length, a.length);
              // Both outputs are lossy H.264; compare every decoded frame and each
              // caption boundary rather than requiring byte-identical encoders.
              for (let frame = 0; frame < 150; frame++) {
                let difference = 0;
                const start = frame * 64 * 64 * 3;
                for (let i = start; i < start + 64 * 64 * 3; i++)
                  difference += Math.abs(a[i] - b[i]);
                assert(
                  difference / (64 * 64 * 3) < 3,
                  `Visual difference at ${format} frame ${frame}: ${difference / (64 * 64 * 3)}`,
                );
              }
              const frameHash = (frame: number) =>
                createHash("sha256")
                  .update(
                    b.subarray(frame * 64 * 64 * 3, (frame + 1) * 64 * 64 * 3),
                  )
                  .digest("hex");
              assert.notEqual(frameHash(29), frameHash(30));
              assert.notEqual(frameHash(59), frameHash(60));
              assert.notEqual(frameHash(89), frameHash(90));
              assert.notEqual(frameHash(104), frameHash(105));
            } finally {
              await media.close();
            }
            assert(
              !(await readdir(root)).some((name) => name.startsWith("static-")),
            );
          },
        );
      }
      await t.test(
        "cancellation before work, between captures and during native encoding removes only owned temporary captures",
        async () => {
          const timeline: Timeline = blankTimeline({
            prompt: "Cancel static encode",
            duration: 20,
            format: "square",
          });
          const plan = staticScenePlan(timeline)!;
          const composition = await selectComposition({
            serveUrl,
            id: "Reelchemy",
            inputProps: { timeline, assetSources: {} },
            browserExecutable,
            puppeteerInstance,
          });
          const directory = path.join(root, "cancel");
          await mkdir(directory);
          const common = {
            timeline,
            plan,
            composition,
            serveUrl,
            assetSources: {},
            browserExecutable,
            puppeteerInstance,
            cancelSignal: makeCancelSignal().cancelSignal,
          };
          const before = path.join(directory, "before.mp4");
          await assert.rejects(
            renderStaticScene({
              ...common,
              outputLocation: before,
              isCancelled: () => true,
              onProgress: () => {},
            }),
            /cancelled/,
          );
          let stopping = false;
          await assert.rejects(
            renderStaticScene({
              ...common,
              outputLocation: path.join(directory, "between.mp4"),
              isCancelled: () => stopping,
              onProgress: () => {
                stopping = true;
              },
            }),
            /cancelled/,
          );
          const during = path.join(directory, "during.mp4");
          await assert.rejects(
            renderStaticScene({
              ...common,
              outputLocation: during,
              isCancelled: () => existsSync(during),
              onProgress: () => {},
            }),
            /cancelled/,
          );
          let incomplete = false;
          try {
            const partial = probe(during);
            const video = partial.streams.find(
              (stream: { codec_type: string }) => stream.codec_type === "video",
            );
            incomplete = Number(video?.nb_frames || 0) < 600;
          } catch {
            incomplete = true;
          }
          assert(
            incomplete,
            "Cancellation must interrupt native encoding before all frames finish.",
          );
          assert(
            !(await readdir(directory)).some((name) =>
              name.startsWith("static-"),
            ),
          );
        },
      );
    });
  },
);
