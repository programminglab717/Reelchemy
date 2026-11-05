import { test } from "node:test";
import assert from "node:assert/strict";
import {
  creatorTemplates,
  creatorTemplateTimeline,
  creatorTemplate,
  type CreatorTemplateId,
} from "../src/lib/creator-templates";
import { sceneNoteCues, captionSceneNotes } from "../src/lib/scene-notes";
import {
  timelineSchema,
  totalFrames,
  captionStyleSchema,
  type Project,
} from "../src/lib/schema";
import { blankTimeline, editHistory } from "../src/lib/editor";
import { subtitles, parseSubtitles } from "../src/lib/captions";
import { exportArchive, importArchive } from "../src/lib/archive";
import { strFromU8, unzipSync } from "fflate";

test("authored starter films have complete bounded scenes, verbatim narration captions, native HD and independent editable state", () => {
  for (const template of creatorTemplates) {
    const film = creatorTemplateTimeline(template.id),
      original = structuredClone(film);
    assert(timelineSchema.safeParse(film).success);
    assert.equal(totalFrames(film), template.duration * 30);
    assert.equal(film.format, template.format);
    assert.equal(film.exportResolution, "1080p");
    assert.equal(
      film.scenes.length,
      template.id === "clear-explainer"
        ? 9
        : template.id === "vertical-launch"
          ? 3
          : 4,
    );
    let start = 0;
    for (const scene of film.scenes) {
      assert(scene.intent.length > 150 && scene.intent.length <= 500);
      assert(scene.layers.some((layer) => layer.id === "title"));
      assert(
        scene.layers.every(
          (layer) =>
            !layer.assetId &&
            layer.x + layer.width <= 1 &&
            layer.y + layer.height <= 1,
        ),
      );
      assert(
        scene.layers
          .filter((layer) => layer.kind === "text")
          .every((layer) => layer.y + layer.height < 0.87),
      );
      const cues = film.captions!.filter(
        (c) =>
          c.startFrame >= start && c.startFrame < start + scene.durationFrames,
      );
      assert.equal(
        cues.map((c) => c.text).join(" "),
        scene.intent.replace(/\s+/g, " ").trim(),
      );
      assert.equal(cues[0].startFrame, start);
      assert.equal(cues.at(-1)!.endFrame, start + scene.durationFrames);
      assert(
        cues.every(
          (c) => c.text.length <= 72 && c.endFrame - c.startFrame >= 15,
        ),
      );
      start += scene.durationFrames;
    }
    assert.deepEqual(creatorTemplateTimeline(template.id), original);
    film.scenes[0].intent = "My new narration";
    film.scenes[0].layers[0].color = "#123456";
    assert.deepEqual(
      creatorTemplateTimeline(template.id),
      original,
      "editing one film must not mutate the shared template",
    );
  }
  assert.throws(
    () => creatorTemplate("__proto__" as CreatorTemplateId),
    /Unknown starter/,
  );
});

test("scene-note captions quantize every word to contiguous positive frames and refuse unreadable or oversized input", () => {
  const notes =
    "A clear idea becomes useful when every scene has a purpose. Keep the language direct, show a specific example, and finish with one useful next step.";
  const cues = sceneNoteCues(notes, 1800, 301, "notes");
  assert.equal(cues.map((c) => c.text).join(" "), notes);
  assert.equal(cues[0].startFrame, 1800);
  assert.equal(cues.at(-1)!.endFrame, 2101);
  cues.forEach((cue, i) => {
    assert(cue.endFrame > cue.startFrame);
    if (i) assert.equal(cues[i - 1].endFrame, cue.startFrame);
  });
  for (const [text, start, duration] of [
    ["", 0, 300],
    ["a".repeat(73), 0, 300],
    ["many words ".repeat(45), 0, 30],
    ["words", -1, 30],
    ["words", 8999, 30],
    ["words", 0, 1],
    ["x".repeat(501), 0, 600],
  ] as const)
    assert.throws(() => sceneNoteCues(text, start, duration));
});

test("turning edited notes into captions changes only that scene and is one undoable command without changing voice tracks or style", () => {
  const film = creatorTemplateTimeline("brand-story");
  film.scenes[1].intent =
    "Show a real example. Tell the viewer why this particular detail matters.";
  film.audioTracks = [
    {
      id: "voice",
      assetId: "00000000-0000-4000-8000-000000000001",
      startFrame: 900,
      offsetFrames: 60,
      durationFrames: 450,
      fadeFrames: 6,
      volume: 0.35,
    },
  ];
  film.captionStyle = captionStyleSchema.parse({
    position: "top",
    fontSize: 32,
  });
  const before = structuredClone(film),
    start = film.scenes[0].durationFrames,
    end = start + film.scenes[1].durationFrames;
  const next = captionSceneNotes(film, 1);
  assert.deepEqual(film, before);
  assert.deepEqual(next.scenes, before.scenes);
  assert.deepEqual(next.captionStyle, before.captionStyle);
  assert.deepEqual(next.audioTracks, before.audioTracks);
  assert.deepEqual(
    next.captions!.filter((c) => c.endFrame <= start || c.startFrame >= end),
    before.captions!.filter((c) => c.endFrame <= start || c.startFrame >= end),
  );
  assert.equal(
    next
      .captions!.filter((c) => c.startFrame >= start && c.startFrame < end)
      .map((c) => c.text)
      .join(" "),
    film.scenes[1].intent,
  );
  const history = editHistory({ past: [], present: film, future: [] }, next);
  assert.equal(history.past.length, 1);
  assert.deepEqual(editHistory(history, "undo").present, before);
});

test("cross-scene captions and full caption allowances refuse a notes replacement atomically", () => {
  const film = blankTimeline({
    prompt: "Notes",
    duration: 60,
    format: "landscape",
  });
  film.scenes[1].intent = "A revised narration";
  film.captions = [
    { id: "across", startFrame: 590, endFrame: 610, text: "Across cut" },
  ];
  const before = structuredClone(film);
  assert.throws(() => captionSceneNotes(film, 1), /crosses this scene/);
  assert.deepEqual(film, before);
  film.captions = Array.from({ length: 500 }, (_, i) => ({
    id: `old-${i}`,
    startFrame: i,
    endFrame: i + 1,
    text: "Kept",
  }));
  assert(timelineSchema.safeParse(film).success);
  assert.throws(() => captionSceneNotes(film, 1), /exceed 500 captions/);
  assert.equal(film.captions.length, 500);
});

test("starter narration, generated subtitles and native-HD/extended archive capabilities survive portable transfer", async () => {
  for (const template of creatorTemplates) {
    const timeline = creatorTemplateTimeline(template.id),
      project: Project = {
        id: "starter",
        name: template.name,
        createdAt: new Date().toISOString(),
        brief: {
          prompt: template.name,
          duration: template.duration,
          format: template.format,
        },
        timeline,
        revisions: [
          {
            id: "initial",
            createdAt: new Date().toISOString(),
            source: "Starter template",
            timeline,
          },
        ],
        messages: [],
      };
    for (const format of ["srt", "vtt"] as const) {
      const cues = parseSubtitles(subtitles(timeline, format), format);
      assert.deepEqual(
        cues.map((c) => [c.text, c.startFrame, c.endFrame]),
        timeline.captions!.map((c) => [c.text, c.startFrame, c.endFrame]),
      );
    }
    const archive = await exportArchive(project),
      manifest = JSON.parse(strFromU8(unzipSync(archive)["project.json"]));
    assert.equal(manifest.version, 4);
    assert(manifest.requiredFeatures.includes("native-hd-v1"));
    assert.equal(
      manifest.requiredFeatures.includes("extended-timeline-v1"),
      template.duration > 60,
    );
    const restored = await importArchive(archive);
    assert.deepEqual(restored.timeline, timeline);
    assert.deepEqual(restored.revisions[0].timeline, timeline);
  }
});
