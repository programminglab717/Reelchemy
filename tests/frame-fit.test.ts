import { test } from "node:test";
import assert from "node:assert/strict";
import { fitLayersToFrame } from "../src/lib/frame-fit";
import { inspectTimeline } from "../src/lib/qc";
import { timelineSchema, type Timeline } from "../src/lib/schema";

const timeline = (layers: unknown[]): Timeline =>
  timelineSchema.parse({
    version: 1,
    fps: 30,
    format: "landscape",
    scenes: [
      {
        id: "s1",
        title: "Scene",
        intent: "Scene",
        durationFrames: 150,
        background: "#101828",
        accent: "#38bdf8",
        strategy: "typography",
        layers,
      },
    ],
  });

test("model-planned layers are kept inside the frame, with their motion", () => {
  const fitted = fitLayersToFrame(
    timeline([
      {
        id: "title",
        kind: "text",
        x: 0.6,
        y: 0.8,
        width: 0.7,
        height: 0.3,
        text: "Hi",
        color: "#ffffff",
        fontSize: 48,
      },
      {
        id: "orb",
        kind: "circle",
        x: 0.2,
        y: 0.2,
        width: 0.4,
        height: 0.4,
        color: "#38bdf8",
        keyframes: [
          { frame: 0, x: 0, y: 0, scale: 1, opacity: 1 },
          { frame: 60, x: 0.7, y: -0.5, scale: 1.2, opacity: 1 },
        ],
      },
    ]),
  );
  const [title, orb] = fitted.scenes[0].layers;
  assert(title.x + title.width <= 1 && title.y + title.height <= 1);
  assert.deepEqual(
    inspectTimeline(fitted).filter((issue) => issue.code === "bounds"),
    [],
  );
  // The second keyframe still moves right and up, but stays in the frame.
  assert(orb.keyframes![1].x > 0 && orb.keyframes![1].y < 0);
  assert.equal(orb.keyframes![1].scale, 1.2);
  assert(orb.x + orb.keyframes![1].x + orb.width * 1.1 <= 1);
});

test("text too large for its box is shrunk to an estimated fit; text that fits is unchanged", () => {
  const fitted = fitLayersToFrame(
    timeline([
      {
        id: "long",
        kind: "text",
        x: 0.1,
        y: 0.1,
        width: 0.4,
        height: 0.2,
        text: "A very long headline that could never fit in this small box",
        color: "#ffffff",
        fontSize: 110,
      },
      {
        id: "short",
        kind: "text",
        x: 0.1,
        y: 0.5,
        width: 0.8,
        height: 0.3,
        text: "Fits",
        color: "#ffffff",
        fontSize: 72,
      },
    ]),
  );
  const [long, short] = fitted.scenes[0].layers;
  assert(long.fontSize < 50, String(long.fontSize));
  assert.equal(short.fontSize, 72);
});
