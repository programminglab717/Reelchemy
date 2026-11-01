import { test } from "node:test";
import assert from "node:assert/strict";
import { blankTimeline } from "../src/lib/editor";
import { staticScenePlan } from "../src/lib/static-scene";

function timeline() {
  return blankTimeline({
    prompt: "Static scene planner",
    duration: 5,
    format: "landscape",
  });
}
test("static frame reuse preserves every output frame and exact caption boundaries without merging different states", () => {
  const t = timeline();
  t.captions = [
    { id: "one", text: "First caption", startFrame: 0, endFrame: 30 },
    { id: "two", text: "Second caption", startFrame: 60, endFrame: 120 },
  ];
  const plan = staticScenePlan(t)!;
  assert.deepEqual(plan.capturedFrames, [0, 30, 60, 120]);
  assert.equal(plan.sourceFrames.length, 150);
  for (const [start, end, source] of [
    [0, 30, 0],
    [30, 60, 30],
    [60, 120, 60],
    [120, 150, 120],
  ])
    assert(
      plan.sourceFrames.slice(start, end).every((frame) => frame === source),
    );
  assert.equal(staticScenePlan(timeline())!.capturedFrames.length, 1);
  // Hidden moving layers cannot change the output; visible unknown kinds fail closed.
  t.scenes[0].layers.push({
    ...t.scenes[0].layers[0],
    id: "hidden",
    kind: "video",
    hidden: true,
  });
  assert(staticScenePlan(t));
});
test("continuous SVG motion, footage, animations, camera/keyframes and transitions keep ordinary frame rendering", () => {
  const t = timeline();
  const layer = t.scenes[0].layers[0];
  for (const kind of ["circle", "nodes", "character", "video"] as const) {
    const next = structuredClone(t);
    next.scenes[0].layers[0].kind = kind;
    assert.equal(staticScenePlan(next), null, kind);
  }
  for (const animation of ["rise", "drift", "pulse"] as const) {
    const next = structuredClone(t);
    next.scenes[0].layers[0].animation = animation;
    assert.equal(staticScenePlan(next), null, animation);
  }
  const key = { frame: 0, x: 0, y: 0, scale: 1, opacity: 1 };
  layer.keyframes = [key];
  assert.equal(staticScenePlan(t), null);
  layer.keyframes = [];
  t.scenes[0].camera = [key];
  assert.equal(staticScenePlan(t), null);
  t.scenes[0].camera = [];
  t.scenes[0].transition = "fade";
  assert.equal(staticScenePlan(t), null);
  t.scenes[0].fadeIn = false;
  t.scenes[0].fadeOut = false;
  assert(staticScenePlan(t));
});
test("short or caption-heavy scenes fall back before allocating capture files", () => {
  const t = timeline();
  t.scenes[0].durationFrames = 60;
  assert.equal(staticScenePlan(t), null);
  t.scenes[0].durationFrames = 150;
  t.captions = Array.from({ length: 5 }, (_, index) => ({
    id: `cue-${index}`,
    text: "Many short captions",
    startFrame: index * 25,
    endFrame: index * 25 + 10,
  }));
  assert.equal(staticScenePlan(t), null);
  const other = structuredClone(t.scenes[0]);
  other.id = "different-scene";
  t.scenes.push(other);
  assert.equal(staticScenePlan(t), null);
});
