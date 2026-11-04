import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, readdir } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { randomUUID, createHash } from "node:crypto";
import sharp from "sharp";
import {
  selectComposition,
  renderMedia,
  makeCancelSignal,
} from "@remotion/renderer";
import { blankTimeline } from "../src/lib/editor";
import { timelineSchema } from "../src/lib/schema";
import { videoCompositePlan } from "../src/lib/video-composite-plan";
import { renderVideoComposite } from "../src/lib/render-video-composite";
import { withRenderBrowser } from "../src/lib/render-browser";
import { verifyPreparedRenderer } from "../src/lib/prepared-renderer";
import { CommandCancelledError } from "../src/lib/process";

test(
  "footage compositing matches every encoded frame across trims, captions, alpha, depth and native-HD fit/crop; cache and cancellation preserve sources",
  { timeout: 240000 },
  async () => {
    const root = await mkdtemp(
      path.join(tmpdir(), "reelchemy-composite-parity-"),
    );
    process.env.REELCHEMY_DATA_DIR = path.join(root, "data");
    process.env.REELCHEMY_RENDER_CACHE_DIR = path.join(root, "cache");
    let passed = false;
    try {
      const { storeVideo } = await import("../src/lib/video");
      const { storeImage, assetDir } = await import("../src/lib/assets");
      const { serveRenderAssets } = await import("../src/lib/render-assets");
      const { renderCachedScenes } = await import("../src/lib/render-cache");
      const source = path.join(root, "generated.mp4");
      execFileSync(
        "ffmpeg",
        [
          "-v",
          "error",
          "-f",
          "lavfi",
          "-i",
          "testsrc2=size=96x64:rate=30:duration=6",
          "-c:v",
          "libx264",
          "-threads",
          "1",
          "-crf",
          "18",
          "-pix_fmt",
          "yuv420p",
          source,
        ],
        { timeout: 15000 },
      );
      const asset = await storeVideo(
        await readFile(source),
        "Synthetic trim.mp4",
        "Generated private fixture",
      );
      const badge = await storeImage(
        await sharp({
          create: {
            width: 32,
            height: 32,
            channels: 4,
            background: { r: 0, g: 255, b: 0, alpha: 0.5 },
          },
        })
          .png()
          .toBuffer(),
        "Synthetic alpha.png",
        "Generated private fixture",
      );
      const digest = async () =>
        createHash("sha256")
          .update(await readFile(path.join(assetDir, asset.id)))
          .update(await readFile(path.join(assetDir, badge.id)))
          .digest("hex");
      const before = await digest();
      const serveUrl = await verifyPreparedRenderer();
      const browserExecutable =
        process.env.CHROMIUM_PATH || "/usr/bin/chromium";
      await withRenderBrowser(browserExecutable, async (puppeteerInstance) => {
        for (const variant of [
          "landscape-standard",
          "landscape-hd",
          "portrait-hd",
        ] as const) {
          const timeline = blankTimeline({
            prompt: "Exact composite parity",
            duration: 5,
            format: variant === "portrait-hd" ? "portrait" : "landscape",
          });
          if (variant !== "landscape-standard")
            timeline.exportResolution = "1080p";
          const base = timeline.scenes[0].layers[0];
          timeline.scenes[0].layers = [
            {
              ...base,
              id: "under",
              kind: "gradient",
              text: "",
              x: 0.05,
              y: 0.2,
              width: 0.9,
              height: 0.55,
              color: "#dc4455",
            },
            {
              ...base,
              id: "footage",
              kind: "video",
              text: "",
              assetId: asset.id,
              x: 0.15,
              y: 0.25,
              width: 0.7,
              height: 0.4,
              mediaPosition: { x: 0.25, y: 0.75 },
              video: {
                startFrame: 15,
                offsetFrames: 30,
                durationFrames: 90,
                fit: variant === "portrait-hd" ? "cover" : "contain",
                audio: false,
                volume: 0,
              },
            },
            {
              ...base,
              id: "heading",
              text: "Foreground",
              x: 0.18,
              y: 0.4,
              width: 0.6,
              height: 0.12,
              fontSize: 24,
            },
            {
              ...base,
              id: "alpha",
              kind: "image",
              text: "",
              assetId: badge.id,
              x: 0.2,
              y: 0.28,
              width: 0.2,
              height: 0.12,
              imageFit: "cover",
            },
          ];
          timeline.captions = [
            { id: "one", text: "First cue", startFrame: 0, endFrame: 30 },
            { id: "two", text: "Second cue", startFrame: 45, endFrame: 90 },
            { id: "three", text: "Final cue", startFrame: 120, endFrame: 145 },
          ];
          const input = timelineSchema.parse(timeline);
          const plan = videoCompositePlan(input)!;
          assert(plan);
          const media = await serveRenderAssets(input);
          try {
            const options = {
              serveUrl,
              id: "Reelchemy",
              inputProps: { timeline: input, assetSources: media.sources },
              browserExecutable,
              puppeteerInstance,
            };
            const composition = await selectComposition(options);
            const baseline = path.join(root, `${variant}-baseline.mp4`),
              optimized = path.join(root, `${variant}-composite.mp4`);
            await renderMedia({
              ...options,
              composition,
              outputLocation: baseline,
              codec: "h264",
              muted: true,
              pixelFormat: "yuv420p",
              concurrency: 2,
            });
            const shared = {
              timeline: input,
              plan,
              composition,
              serveUrl,
              assetSources: media.sources,
              browserExecutable,
              puppeteerInstance,
              cancelSignal: makeCancelSignal().cancelSignal,
              isCancelled: () => false,
              onProgress: () => {},
            };
            await renderVideoComposite({
              ...shared,
              outputLocation: optimized,
            });
            const pixels = (file: string) =>
              execFileSync(
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
                { timeout: 30000, maxBuffer: 4 * 1024 ** 2 },
              );
            const a = pixels(baseline),
              b = pixels(optimized),
              perFrame = 64 * 64 * 3;
            assert.equal(a.length, 150 * perFrame);
            assert.equal(b.length, a.length);
            for (let frame = 0; frame < 150; frame++) {
              let error = 0;
              for (let i = frame * perFrame; i < (frame + 1) * perFrame; i++)
                error += Math.abs(a[i] - b[i]);
              assert(
                error / perFrame < 4,
                `${variant}, frame ${frame}, mean absolute encoded RGB error ${error / perFrame}`,
              );
            }
            if (variant === "landscape-standard") {
              const namespace = randomUUID();
              const cacheOptions = {
                ...shared,
                namespace,
                assetFingerprints: media.fingerprints,
                outputLocation: path.join(root, "cached.mp4"),
              };
              const first = await renderCachedScenes(cacheOptions);
              assert.equal(first[0].reused, false);
              assert(first[0].compositeReuse);
              const replay = await renderCachedScenes({
                ...cacheOptions,
                outputLocation: path.join(root, "cached-again.mp4"),
              });
              assert.equal(replay[0].reused, true);
              let cancelled = false;
              await assert.rejects(
                () =>
                  renderVideoComposite({
                    ...shared,
                    outputLocation: path.join(root, "cancelled.mp4"),
                    isCancelled: () => cancelled,
                    onProgress: () => {
                      cancelled = true;
                    },
                  }),
                CommandCancelledError,
              );
              assert(
                !(await readdir(root)).some((name) =>
                  name.startsWith("composite-"),
                ),
              );
            }
          } finally {
            await media.close();
          }
        }
      });
      assert.equal(await digest(), before);
      passed = true;
    } finally {
      if (passed) await rm(root, { recursive: true, force: true });
      else
        console.error(
          `Synthetic composite comparison retained for review: ${root}`,
        );
    }
  },
);
