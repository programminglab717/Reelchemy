import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { blankTimeline } from "../src/lib/editor";
import { mockPlan } from "../src/lib/demo-plan";
import { timelineSchema, totalFrames, type Project } from "../src/lib/schema";
import { parseSubtitles, importCaptions, subtitles } from "../src/lib/captions";
import { usesExtendedTimeline } from "../src/lib/timeline-limits";
import { exportArchive, importArchive } from "../src/lib/archive";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";

const brief = {
  prompt: "A complete narrated story",
  duration: 300,
  format: "landscape" as const,
};
test("five-minute plans, late narration and 500 caption cues retain exact boundaries and reject the next frame", () => {
  for (const duration of [5, 60, 61, 180, 299, 300])
    for (const create of [blankTimeline, mockPlan]) {
      const timeline = create({ ...brief, duration });
      assert.equal(totalFrames(timeline), duration * 30);
      assert(timeline.scenes.every((s) => s.durationFrames <= 600));
      assert(timelineSchema.safeParse(timeline).success);
      assert.equal(usesExtendedTimeline(timeline), duration > 60);
    }
  const timeline = blankTimeline(brief);
  timeline.audioTracks = [
    {
      id: "last-take",
      assetId: randomUUID(),
      startFrame: 8700,
      offsetFrames: 0,
      durationFrames: 300,
      volume: 0.8,
      fadeFrames: 6,
    },
  ];
  timeline.captions = Array.from({ length: 500 }, (_, i) => ({
    id: `cue-${i}`,
    startFrame: i * 18,
    endFrame: (i + 1) * 18,
    text: `Line ${i + 1}`,
  }));
  assert(timelineSchema.safeParse(timeline).success);
  for (const format of ["srt", "vtt"] as const) {
    const cues = parseSubtitles(subtitles(timeline, format), format);
    const imported = importCaptions(timeline, cues, "replace");
    assert.equal(imported.captions!.length, 500);
    assert.equal(imported.captions!.at(-1)!.endFrame, 9000);
  }
  const invalid = structuredClone(timeline);
  invalid.scenes.push({
    ...structuredClone(invalid.scenes[0]),
    id: "overflow",
    durationFrames: 30,
  });
  assert(!timelineSchema.safeParse(invalid).success);
  invalid.scenes.pop();
  invalid.captions!.push({
    id: "overflow",
    startFrame: 0,
    endFrame: 1,
    text: "Too many",
  });
  assert(!timelineSchema.safeParse(invalid).success);
  assert.throws(() =>
    parseSubtitles(
      "1\n00:04:59,000 --> 00:05:00,001\nBeyond five minutes",
      "srt",
    ),
  );
});

test("oversized but otherwise valid editing detail cannot be saved and then disappear from bounded editor reads", () => {
  const timeline = blankTimeline(brief),
    base = timeline.scenes[0];
  const keys = Array.from({ length: 30 }, (_, frame) => ({
    frame,
    x: 0.123456789012345,
    y: 0.123456789012345,
    scale: 1.123456789012345,
    opacity: 0.987654321098765,
  }));
  timeline.scenes = Array.from({ length: 60 }, (_, i) => ({
    ...structuredClone(base),
    id: `scene-${i}`,
    durationFrames: 150,
    layers: Array.from({ length: 20 }, (_, j) => ({
      ...structuredClone(base.layers[0]),
      id: `layer-${j}`,
      keyframes: keys,
    })),
  }));
  const parsed = timelineSchema.safeParse(timeline);
  assert(!parsed.success);
  assert(
    parsed.error.issues.some((issue) =>
      issue.message.includes("reopen safely"),
    ),
  );
});

test("extended current/history/brief archives fence older readers and preserve HD capability independently", async () => {
  const extended = blankTimeline(brief),
    short = blankTimeline({ ...brief, duration: 5 });
  for (const mode of ["current", "history", "brief", "hd-history"] as const) {
    const project: Project = {
      id: "portable",
      name: "Long film",
      createdAt: new Date().toISOString(),
      brief: mode === "brief" ? brief : { ...brief, duration: 5 },
      timeline: mode === "current" ? extended : short,
      messages: [],
      revisions:
        mode === "history" || mode === "hd-history"
          ? [
              {
                id: "retained",
                createdAt: new Date().toISOString(),
                source: "Saved",
                timeline: {
                  ...extended,
                  ...(mode === "hd-history"
                    ? { exportResolution: "1080p" as const }
                    : {}),
                },
              },
            ]
          : [],
    };
    const archive = await exportArchive(project),
      files = unzipSync(archive),
      manifest = JSON.parse(strFromU8(files["project.json"]));
    assert.equal(manifest.version, 4);
    assert(manifest.requiredFeatures.includes("extended-timeline-v1"));
    assert.equal(
      manifest.requiredFeatures.includes("native-hd-v1"),
      mode === "hd-history",
    );
    const restored = await importArchive(archive);
    assert.deepEqual(restored.timeline, project.timeline);
    assert.deepEqual(
      restored.revisions.map((r) => r.timeline),
      project.revisions.map((r) => r.timeline),
    );
    for (const version of [1, 3, 4]) {
      const forged = {
        ...manifest,
        version,
        requiredFeatures: manifest.requiredFeatures.filter(
          (f: string) => f !== "extended-timeline-v1",
        ),
      };
      await assert.rejects(() =>
        importArchive(
          zipSync({
            ...files,
            "project.json": strToU8(JSON.stringify(forged)),
          }),
        ),
      );
    }
  }
});
