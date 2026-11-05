import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { blankTimeline } from "../src/lib/editor";
import { timelineSchema } from "../src/lib/schema";

test(
  "native 1080p mixed-media exports preserve standard framing, type, captions, source audio and originals",
  { timeout: 120000 },
  async () => {
    const root = await mkdtemp(
      path.join(tmpdir(), "reelchemy-native-resolution-"),
    );
    process.env.REELCHEMY_DATA_DIR = path.join(root, "data");
    process.env.REELCHEMY_RENDER_CACHE_DIR = path.join(root, "cache");
    try {
      const { storeVideo } = await import("../src/lib/video");
      const { assetDir } = await import("../src/lib/assets");
      const { renderFilm } = await import("../src/lib/render");
      const source = path.join(root, "synthetic.mp4");
      execFileSync(
        "ffmpeg",
        [
          "-v",
          "error",
          "-f",
          "lavfi",
          "-i",
          "testsrc2=size=160x90:rate=30:duration=2",
          "-f",
          "lavfi",
          "-i",
          "sine=frequency=440:sample_rate=48000:duration=2",
          "-c:v",
          "libx264",
          "-threads",
          "1",
          "-pix_fmt",
          "yuv420p",
          "-c:a",
          "aac",
          source,
        ],
        { timeout: 15000 },
      );
      const asset = await storeVideo(
        await readFile(source),
        "Synthetic footage.mp4",
        "Generated offline fixture",
      );
      const original = createHash("sha256")
        .update(await readFile(path.join(assetDir, asset.id)))
        .digest("hex");
      for (const format of ["landscape", "portrait"] as const) {
        const timeline = blankTimeline({
          prompt: "Resolution parity",
          duration: 5,
          format,
        });
        const scene = timeline.scenes[0],
          base = scene.layers[0];
        scene.durationFrames = 60;
        scene.layers = [
          {
            ...base,
            id: "heading",
            text: "A clear story",
            y: 0.05,
            height: 0.1,
            fontSize: 32,
            letterSpacing: 1,
          },
          {
            ...base,
            id: "footage",
            kind: "video",
            assetId: asset.id,
            x: 0.1,
            y: 0.2,
            width: 0.8,
            height: 0.55,
            video: {
              startFrame: 0,
              offsetFrames: 0,
              durationFrames: 60,
              volume: 0.2,
              audio: true,
              fit: "contain",
            },
          },
          {
            ...base,
            id: "badge",
            kind: "gradient",
            x: 0.7,
            y: 0.06,
            width: 0.15,
            height: 0.1,
            color: "#d5f281",
            animation: "rise",
          },
        ];
        timeline.captions = [
          {
            id: "cue",
            text: "Made in this studio",
            startFrame: 0,
            endFrame: 55,
          },
        ];
        const hd = timelineSchema.parse({
          ...timeline,
          exportResolution: "1080p",
        });
        const namespace = randomUUID();
        const standard = await renderFilm(
          timelineSchema.parse(timeline),
          path.join(root, `${format}-standard`),
          undefined,
          undefined,
          undefined,
          namespace,
        );
        const full = await renderFilm(
          hd,
          path.join(root, `${format}-1080p`),
          undefined,
          undefined,
          undefined,
          namespace,
        );
        assert.equal(standard.sceneCache[0].reused, false);
        assert.equal(
          full.sceneCache[0].reused,
          false,
          "the lower-resolution clip must not satisfy native HD",
        );
        assert.deepEqual(
          [full.export.width, full.export.height],
          format === "landscape" ? [1920, 1080] : [1080, 1920],
        );
        assert.equal(full.export.fps, 30);
        assert.equal(full.export.duration, 2);
        const sample = full.qc.samples[0];
        const fromMovie = execFileSync(
          "ffmpeg",
          [
            "-v",
            "error",
            "-threads",
            "2",
            "-filter_threads",
            "1",
            "-i",
            full.export.path,
            "-vf",
            `select=eq(n\\,${sample.frame})`,
            "-frames:v",
            "1",
            "-pix_fmt",
            "rgb24",
            "-f",
            "rawvideo",
            "pipe:1",
          ],
          { timeout: 15000, maxBuffer: 8 * 1024 ** 2 },
        );
        const fromEvidence = execFileSync(
          "ffmpeg",
          [
            "-v",
            "error",
            "-threads",
            "2",
            "-i",
            path.join(path.dirname(full.export.path), sample.file),
            "-frames:v",
            "1",
            "-pix_fmt",
            "rgb24",
            "-f",
            "rawvideo",
            "pipe:1",
          ],
          { timeout: 15000, maxBuffer: 8 * 1024 ** 2 },
        );
        assert.deepEqual(
          fromEvidence,
          fromMovie,
          "review evidence must be the actual encoded frame",
        );
        assert(full.qc.audio.peakDb !== null && full.qc.audio.peakDb > -80);
        const meta = JSON.parse(
          execFileSync(
            "ffprobe",
            ["-v", "error", "-show_streams", "-of", "json", full.export.path],
            { encoding: "utf8", timeout: 15000 },
          ),
        );
        assert.equal(
          meta.streams.find(
            (s: { codec_type: string }) => s.codec_type === "video",
          ).nb_frames,
          "60",
        );
        assert.equal(
          meta.streams.find(
            (s: { codec_type: string }) => s.codec_type === "audio",
          ).codec_name,
          "aac",
        );
        const normalized = (file: string) =>
          execFileSync(
            "ffmpeg",
            [
              "-v",
              "error",
              "-threads",
              "2",
              "-filter_threads",
              "1",
              "-ss",
              "1",
              "-i",
              file,
              "-frames:v",
              "1",
              "-vf",
              format === "landscape" ? "scale=128:72" : "scale=72:128",
              "-pix_fmt",
              "rgb24",
              "-f",
              "rawvideo",
              "pipe:1",
            ],
            { timeout: 15000 },
          );
        const a = normalized(standard.export.path),
          b = normalized(full.export.path);
        assert.equal(a.length, b.length);
        const mean =
          a.reduce((sum, value, index) => sum + Math.abs(value - b[index]), 0) /
          a.length;
        assert(mean < 5, `normalized framing/type/caption pixel error ${mean}`);
      }
      assert.equal(
        createHash("sha256")
          .update(await readFile(path.join(assetDir, asset.id)))
          .digest("hex"),
        original,
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);
