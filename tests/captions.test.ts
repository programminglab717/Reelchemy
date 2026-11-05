import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MAX_SUBTITLE_BYTES,
  parseSubtitles,
  importCaptions,
  subtitles,
} from "../src/lib/captions";
import { MAX_CAPTIONS } from "../src/lib/timeline-limits";
import { blankTimeline } from "../src/lib/editor";
import { captionStyleSchema } from "../src/lib/schema";
import { localSceneTimeline, sceneCacheKey } from "../src/lib/render-cache";
import { checkLayout } from "../src/lib/layout-qc";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";

test("SRT/VTT import preserves literal text, removes supported formatting and quantizes timing", () => {
  const cues = parseSubtitles(
    "\uFEFF1\r\n00:00:00,017 --> 00:00:01,999\r\n<b>Hello</b> &amp; &lt;world&gt;\r\nnext line\r\n\r\n2\r\n00:00:02,000 --> 00:00:03,000\r\n&#x1F600; &#65;",
    "srt",
  );
  assert.deepEqual(
    cues.map((c) => ({ ...c, id: "same" })),
    [
      {
        id: "same",
        startFrame: 1,
        endFrame: 60,
        text: "Hello & <world> next line",
      },
      { id: "same", startFrame: 60, endFrame: 90, text: "😀 A" },
    ],
  );
  const t = {
    ...blankTimeline({ duration: 5, format: "portrait", prompt: "Captions" }),
    captions: cues,
  };
  for (const format of ["srt", "vtt"] as const)
    assert.deepEqual(
      parseSubtitles(subtitles(t, format), format).map((c) => ({
        ...c,
        id: "same",
      })),
      cues.map((c) => ({ ...c, id: "same" })),
    );
  assert.equal(
    parseSubtitles(
      "WEBVTT\n\nNOTE comment\nignored\n\nintro\n00:01.000 --> 00:02.000\n<v Narrator>Spoken</v>",
      "vtt",
    )[0].text,
    "Spoken",
  );
});
test("subtitle import fails atomically on invalid timing, overlap, limits and unsupported styles", () => {
  const t = blankTimeline({
    duration: 5,
    format: "landscape",
    prompt: "Import",
  });
  const original = JSON.stringify(t);
  for (const input of [
    "1\n00:00:01,000 --> 00:00:01,001\nToo short",
    "1\n00:00:01,000 --> 00:00:06,000\nToo long",
    "1\n00:00:00,000 --> 00:00:02,000\nFirst\n\n2\n00:00:01,000 --> 00:00:03,000\nOverlap",
  ])
    assert.throws(
      () => importCaptions(t, parseSubtitles(input, "srt"), "replace"),
      /Imported captions/,
    );
  for (const input of [
    "1\n00:60:00,000 --> 00:00:02,000\nInvalid",
    "1\n00:00:00,000 --> 00:00:02,000 align:start\nPositioning",
    "1\n00:00:00,000 --> 00:00:02,000\n<script>custom</script>",
    `1\n00:00:00,000 --> 00:00:02,000\n${"a".repeat(81)}`,
    "a".repeat(MAX_SUBTITLE_BYTES + 1),
  ])
    assert.throws(() => parseSubtitles(input, "srt"));
  assert.throws(() =>
    parseSubtitles("WEBVTT\n\nSTYLE\n::cue {color:red}", "vtt"),
  );
  assert.throws(() => parseSubtitles("WEBVTT\n\n", "vtt"), /No subtitle/);
  assert.equal(JSON.stringify(t), original);
  const cues = parseSubtitles("1\n00:00:00,000 --> 00:00:01,000\nFirst", "srt");
  const imported = importCaptions(t, cues, "replace");
  assert.throws(() => importCaptions(imported, cues, "merge"));
  assert.equal(
    importCaptions(
      imported,
      parseSubtitles("1\n00:00:01,000 --> 00:00:02,000\nSecond", "srt"),
      "merge",
    ).captions?.length,
    2,
  );
});
test("caption style survives scene extraction and invalidates the scene cache", () => {
  const t = blankTimeline({
    duration: 5,
    format: "landscape",
    prompt: "Style",
  });
  t.captions = [{ id: "cue", startFrame: 0, endFrame: 30, text: "Styled" }];
  const before = sceneCacheKey(localSceneTimeline(t, 0), {}, "same");
  t.captionStyle = captionStyleSchema.parse({
    position: "top",
    color: "#ffff00",
    fontSize: 40,
  });
  const local = localSceneTimeline(t, 0);
  assert.deepEqual(local.captionStyle, t.captionStyle);
  assert.notEqual(sceneCacheKey(local, {}, "same"), before);
});
test("Chromium checks every caption for clipping in each output geometry", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "reelchemy-caption-layout-"));
  try {
    for (const format of ["landscape", "portrait", "square"] as const) {
      const t = blankTimeline({ duration: 5, format, prompt: "Layout" });
      t.scenes[0].layers = [];
      t.captions = [
        { id: "cue", startFrame: 1, endFrame: 2, text: "M".repeat(80) },
      ];
      t.captionStyle = captionStyleSchema.parse({
        fontFamily: "mono",
        fontSize: 56,
      });
      const clipped = await checkLayout(t, dir);
      // Square output has the tightest caption region relative to font size.
      if (format === "square")
        assert(
          clipped.after.some(
            (i) => i.layerId === "cue" && i.code === "text-overflow",
          ),
          `${format} clipping must be reported`,
        );
      t.captionStyle.fontSize = 18;
      assert.equal((await checkLayout(t, dir)).after.length, 0);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("all 500 maximum-length Unicode and escaped captions reimport from exported subtitles", () => {
  const t = blankTimeline({
    duration: 300,
    format: "portrait",
    prompt: "Full subtitles",
  });
  for (const text of ["&".repeat(80), "界".repeat(80), "😀".repeat(40)]) {
    t.captions = Array.from({ length: MAX_CAPTIONS }, (_, i) => ({
      id: `cue-${i}`,
      startFrame: i * 18,
      endFrame: (i + 1) * 18,
      text,
    }));
    for (const format of ["srt", "vtt"] as const) {
      const exported = subtitles(t, format);
      const bytes = Buffer.byteLength(exported);
      assert(bytes > 64 * 1024);
      assert(bytes <= MAX_SUBTITLE_BYTES);
      const imported = importCaptions(
        t,
        parseSubtitles(exported, format),
        "replace",
      );
      assert.deepEqual(
        imported.captions?.map(({ id: _id, ...cue }) => cue),
        t.captions.map(({ id: _id, ...cue }) => cue),
      );
    }
  }
  assert.throws(
    () =>
      parseSubtitles(
        "界".repeat(Math.floor(MAX_SUBTITLE_BYTES / 3) + 1),
        "srt",
      ),
    /256 KB/,
  );
});
