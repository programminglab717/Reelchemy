import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { blankTimeline, editHistory } from "../src/lib/editor";
import {
  timelineSchema,
  totalFrames,
  type Timeline,
  type AudioTrack,
} from "../src/lib/schema";
import { deleteSceneAndCloseGap } from "../src/lib/scene-ripple";
import { creatorTemplateTimeline } from "../src/lib/creator-templates";
import { clipAudioTracks } from "../src/lib/clip-audio";
const assetId = randomUUID();
function film(): Timeline {
  const t = blankTimeline({
    duration: 15,
    format: "landscape",
    prompt: "A synchronized cut",
  });
  t.scenes = [0, 1, 2].map((i) => ({
    ...structuredClone(t.scenes[0]),
    id: `scene-${i}`,
    durationFrames: 150,
  }));
  return timelineSchema.parse(t);
}
function audio(
  id: string,
  startFrame: number,
  durationFrames: number,
  offsetFrames = 0,
): AudioTrack {
  return {
    id,
    assetId,
    startFrame,
    durationFrames,
    offsetFrames,
    fadeFrames: Math.min(20, Math.floor(durationFrames / 2)),
    volume: 0.7,
  };
}
test("deleting an authored scene closes its captions, preserves other scene data and is one reversible edit", () => {
  const t = creatorTemplateTimeline("brand-story"),
    original = structuredClone(t);
  // The former UI operation cannot delete this valid captioned starter.
  assert.equal(
    timelineSchema.safeParse({ ...t, scenes: t.scenes.slice(1) }).success,
    false,
  );
  const next = deleteSceneAndCloseGap(t, 0);
  assert.equal(totalFrames(next), 1350);
  assert.deepEqual(next.scenes, t.scenes.slice(1));
  assert.deepEqual(
    next.captions,
    t
      .captions!.filter((c) => c.startFrame >= 450)
      .map((c) => ({
        ...c,
        startFrame: c.startFrame - 450,
        endFrame: c.endFrame - 450,
      })),
  );
  assert.deepEqual(next.captionStyle, t.captionStyle);
  assert.deepEqual(t, original);
  const history = editHistory({ past: [], present: t, future: [] }, next);
  assert.equal(history.past.length, 1);
  assert.deepEqual(editHistory(history, "undo").present, t);
  assert.deepEqual(
    editHistory(editHistory(history, "undo"), "redo").present,
    next,
  );
  next.scenes[0].layers[0].text = "Independent edit";
  assert.deepEqual(t, original);
});
test("a middle cut clips crossing captions and splits audio with exact retained source ranges and bounded fades", () => {
  const t = film();
  t.audioTracks = [
    audio("before", 0, 60),
    audio("left", 100, 100, 10),
    audio("inside", 160, 20, 20),
    audio("right", 260, 80, 30),
    audio("spanning", 120, 240, 40),
    audio("after", 350, 50),
  ];
  t.captions = [
    [0, 30],
    [100, 160],
    [170, 200],
    [280, 310],
    [350, 400],
  ].map(([startFrame, endFrame], i) => ({
    id: `cue-${i}`,
    startFrame,
    endFrame,
    text: `Words ${i}`,
  }));
  assert(timelineSchema.safeParse(t).success);
  const original = structuredClone(t),
    next = deleteSceneAndCloseGap(t, 1);
  assert.equal(totalFrames(next), 300);
  assert.deepEqual(
    next.captions?.map((c) => [c.id, c.startFrame, c.endFrame]),
    [
      ["cue-0", 0, 30],
      ["cue-1", 100, 150],
      ["cue-3", 150, 160],
      ["cue-4", 200, 250],
    ],
  );
  const kept = next.audioTracks!;
  assert.deepEqual(
    kept
      .filter((a) => a.id !== "spanning" && a.assetId === assetId)
      .map((a) => [
        a.startFrame,
        a.offsetFrames,
        a.durationFrames,
        a.fadeFrames,
      ]),
    [
      [0, 0, 60, 20],
      [100, 10, 50, 20],
      [150, 70, 40, 20],
      [150, 220, 60, 20],
      [200, 0, 50, 20],
    ],
  );
  assert.deepEqual(
    kept.find((a) => a.id === "spanning"),
    { ...t.audioTracks[4], durationFrames: 30, fadeFrames: 15 },
  );
  assert.equal(new Set(kept.map((a) => a.id)).size, kept.length);
  assert(kept.every((a) => a.assetId === assetId && a.volume === 0.7));
  assert.deepEqual(t, original);
  const crossing = {
    ...t,
    captions: [
      {
        id: "across",
        startFrame: 140,
        endFrame: 330,
        text: "Keep these words",
      },
    ],
  };
  assert.deepEqual(deleteSceneAndCloseGap(crossing, 1).captions, [
    { id: "across", startFrame: 140, endFrame: 180, text: "Keep these words" },
  ]);
});
test("first/last scene deletion preserves boundary-aligned tracks, optional fields and local footage phases", () => {
  const t = film();
  t.scenes[2].motionOffsetFrames = 100;
  t.scenes[2].layers.push({
    ...t.scenes[2].layers[0],
    id: "footage",
    kind: "video",
    assetId,
    video: {
      startFrame: 20,
      offsetFrames: 70,
      durationFrames: 90,
      fit: "contain",
      audio: true,
      volume: 0.6,
    },
  });
  t.audioTracks = [
    { ...audio("exact-middle", 150, 150), fadeFrames: 0 },
    { ...audio("exact-last", 300, 150), fadeFrames: 0 },
  ];
  const cutFirst = deleteSceneAndCloseGap(t, 0);
  assert.deepEqual(cutFirst.scenes[1], timelineSchema.parse(t).scenes[2]);
  assert.deepEqual(
    clipAudioTracks(cutFirst).map((a) => [
      a.startFrame,
      a.offsetFrames,
      a.durationFrames,
    ]),
    [[170, 70, 90]],
  );
  assert.deepEqual(
    cutFirst.audioTracks?.map((a) => [a.id, a.startFrame]),
    [
      ["exact-middle", 0],
      ["exact-last", 150],
    ],
  );
  assert.deepEqual(deleteSceneAndCloseGap(t, 2).audioTracks, [
    t.audioTracks[0],
  ]);
  const empty = film(),
    without = deleteSceneAndCloseGap(empty, 1);
  assert.equal(without.audioTracks, undefined);
  assert.equal(without.captions, undefined);
});
test("invalid or track-capacity cuts refuse atomically instead of dropping narration", () => {
  const t = film();
  t.audioTracks = Array.from({ length: 12 }, (_, i) => ({
    ...audio(`span-${i}`, 0, 450),
    fadeFrames: 0,
  }));
  const original = structuredClone(t);
  assert.throws(
    () => deleteSceneAndCloseGap(t, 1),
    /more than 12 audio tracks/,
  );
  assert.deepEqual(t, original);
  for (const index of [-1, 0.5, 3, Number.NaN])
    assert.throws(() => deleteSceneAndCloseGap(t, index), /Choose a scene/);
  const one = blankTimeline({
    duration: 5,
    format: "portrait",
    prompt: "Keep one",
  });
  assert.throws(() => deleteSceneAndCloseGap(one, 0), /at least one scene/);
});
