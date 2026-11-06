import { test } from "node:test";
import assert from "node:assert/strict";
import { mockPlan, generatePlan } from "../src/lib/provider";
import {
  timelineSchema,
  totalFrames,
  sceneAt,
  animationState,
  formats,
} from "../src/lib/schema";
import { inspectTimeline, repairBounds } from "../src/lib/qc";
const brief = {
  prompt: "A landscape that connects ideas",
  duration: 30,
  format: "landscape" as const,
};
test("demo plans three distinct strategies, exact requested duration, no QC errors", () => {
  const t = mockPlan(brief);
  assert.equal(totalFrames(t), 900);
  assert.equal(new Set(t.scenes.map((s) => s.strategy)).size, 3);
  assert.deepEqual(inspectTimeline(t), []);
});
test("scene boundaries have no gaps or overlaps", () => {
  const t = mockPlan(brief);
  assert.equal(sceneAt(t, 0)?.scene.id, "scene-1");
  assert.equal(sceneAt(t, 299)?.localFrame, 299);
  assert.equal(sceneAt(t, 300)?.scene.id, "scene-2");
  assert.equal(sceneAt(t, 899)?.localFrame, 299);
  assert.equal(sceneAt(t, 900), null);
  assert.equal(sceneAt(t, -1), null);
});
test("schemas reject impossible duration, duplicate IDs, non-finite coordinates, and non-colors", () => {
  for (const mutate of [
    (t: ReturnType<typeof mockPlan>) => {
      t.scenes[0].durationFrames = 9999;
    },
    (t: ReturnType<typeof mockPlan>) => {
      t.scenes[1].id = t.scenes[0].id;
    },
    (t: ReturnType<typeof mockPlan>) => {
      t.scenes[0].layers[0].x = NaN;
    },
    (t: ReturnType<typeof mockPlan>) => {
      t.scenes[0].background = "url(https://example.com)";
    },
  ]) {
    const t = mockPlan(brief);
    mutate(t);
    assert.equal(timelineSchema.safeParse(t).success, false);
  }
});
test("animation evaluation is frame-addressable and deterministic", () => {
  const a = animationState(33, "drift");
  animationState(600, "drift");
  assert.deepEqual(animationState(33, "drift"), a);
  assert.notDeepEqual(animationState(34, "drift"), a);
  assert.equal(animationState(0, "rise").opacity, 0);
  assert.equal(animationState(20, "rise").translateY, 0);
});
test("overlapping text and missing assets are surfaced without endless repair", () => {
  const t = mockPlan(brief);
  t.scenes[0].layers[1].y = 0.1;
  t.scenes[0].layers[2].assetId = "missing";
  const result = repairBounds(t, 100);
  assert(result.after.some((i) => i.code === "overlap"));
  assert(result.after.some((i) => i.code === "missing-asset"));
  assert(result.attempts <= 2);
});
test("bounded repair changes only affected scene and preserves evidence", () => {
  const t = mockPlan(brief);
  t.scenes[0].layers[0].x = 0.9;
  const repaired = repairBounds(t);
  assert(repaired.before.some((i) => i.code === "bounds"));
  assert(!repaired.after.some((i) => i.code === "bounds"));
  assert.equal(repaired.attempts, 1);
  assert.deepEqual(repaired.timeline.scenes[1], t.scenes[1]);
  assert.equal(t.scenes[0].layers[0].x, 0.9);
});
test("all formats produce schema-valid plans at boundary durations", () => {
  for (const format of Object.keys(formats) as (keyof typeof formats)[])
    for (const duration of [5, 60])
      assert.equal(
        totalFrames(
          timelineSchema.parse(mockPlan({ ...brief, format, duration })),
        ),
        duration * 30,
      );
});
test("compatible provider sends server credentials and validates returned storyboard", async () => {
  const oldFetch = globalThis.fetch;
  const saved = { ...process.env };
  try {
    process.env.AI_PROVIDER = "compatible";
    process.env.AI_BASE_URL = "https://example.com/v1";
    process.env.AI_MODEL = "test";
    process.env.AI_API_KEY = "test-only";
    globalThis.fetch = async (input, init) => {
      assert.equal(String(input), "https://example.com/v1/chat/completions");
      assert.equal(
        (init?.headers as Record<string, string>).Authorization,
        "Bearer test-only",
      );
      return Response.json({
        choices: [{ message: { content: JSON.stringify(mockPlan(brief)) } }],
      });
    };
    const result = await generatePlan(brief);
    assert.equal(result.provider, "compatible");
    globalThis.fetch = async () =>
      Response.json({ choices: [{ message: { content: "{}" } }] });
    await assert.rejects(() => generatePlan(brief));
  } finally {
    globalThis.fetch = oldFetch;
    for (const k of ["AI_PROVIDER", "AI_BASE_URL", "AI_MODEL", "AI_API_KEY"]) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
});
test("scene-local demo revision preserves timing, IDs and all unrelated scenes", async () => {
  const { reviseScene } = await import("../src/lib/provider");
  const t = mockPlan(brief);
  const result = await reviseScene(t, "scene-2", "A new dawn");
  assert.deepEqual(result.scenes[0], t.scenes[0]);
  assert.deepEqual(result.scenes[2], t.scenes[2]);
  assert.equal(result.scenes[1].durationFrames, t.scenes[1].durationFrames);
  assert.equal(
    result.scenes[1].layers.find((l) => l.id === "title")?.text,
    "A new dawn",
  );
  assert.notEqual(t.scenes[1].intent, "A new dawn");
});
test("native Claude adapter uses Messages headers and validates structured response", async () => {
  const oldFetch = globalThis.fetch;
  const saved = { ...process.env };
  try {
    process.env.AI_PROVIDER = "anthropic";
    delete process.env.AI_BASE_URL;
    process.env.AI_MODEL = "test";
    process.env.AI_API_KEY = "test-only";
    globalThis.fetch = async (input, init) => {
      assert.equal(String(input), "https://api.anthropic.com/v1/messages");
      assert.equal(
        (init?.headers as Record<string, string>)["x-api-key"],
        "test-only",
      );
      const payload = JSON.parse(init!.body as string);
      assert(payload.system.includes("JSON"));
      assert.equal(payload.messages.length, 1);
      return Response.json({
        content: [{ type: "text", text: JSON.stringify(mockPlan(brief)) }],
      });
    };
    assert.equal((await generatePlan(brief)).provider, "anthropic");
  } finally {
    globalThis.fetch = oldFetch;
    for (const k of ["AI_PROVIDER", "AI_BASE_URL", "AI_MODEL", "AI_API_KEY"]) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
});
test("custom keyframes interpolate deterministically and invalid ordering is rejected", async () => {
  const { layerMotion } = await import("../src/lib/schema");
  const t = mockPlan(brief);
  const l = t.scenes[0].layers[0];
  l.keyframes = [
    { frame: 0, x: 0, y: 0, scale: 1, opacity: 0 },
    { frame: 20, x: 0.2, y: 0.4, scale: 2, opacity: 1 },
  ];
  assert.deepEqual(layerMotion(l, 10), {
    x: 0.1,
    y: 0.2,
    scale: 1.5,
    opacity: 0.5,
    translateY: 0,
    // Keys without rotation add none to the layer's static rotation.
    rotation: 0,
  });
  assert.equal(layerMotion(l, 40).opacity, 1);
  l.keyframes[1].frame = 0;
  assert.equal(timelineSchema.safeParse(t).success, false);
});
test("camera keyframes share deterministic interpolation and reject invalid frame ordering", async () => {
  const { keyframeMotion } = await import("../src/lib/schema");
  const t = mockPlan(brief);
  t.scenes[0].camera = [
    { frame: 0, x: 0, y: 0, scale: 1, opacity: 1 },
    { frame: 20, x: 0.1, y: -0.1, scale: 1.2, opacity: 1 },
  ];
  assert.equal(keyframeMotion(t.scenes[0].camera, 10).scale, 1.1);
  assert(timelineSchema.safeParse(t).success);
  t.scenes[0].camera[1].frame = 0;
  assert.equal(timelineSchema.safeParse(t).success, false);
});
test("contrast and caption readability warnings remain distinct from blocking defects", async () => {
  const { contrastRatio } = await import("../src/lib/qc");
  assert.equal(contrastRatio("#FFFFFF", "#000000"), 21);
  const t = mockPlan(brief);
  t.scenes[0].layers[1].color = t.scenes[0].background;
  t.captions = [
    {
      id: "fast",
      text: "This cue is much too fast to read.",
      startFrame: 0,
      endFrame: 1,
    },
  ];
  const issues = inspectTimeline(t);
  assert(issues.some((i) => i.code === "contrast" && i.severity === "warning"));
  assert(
    issues.some((i) => i.sceneId === "captions" && i.code === "readability"),
  );
  assert(!issues.some((i) => i.severity === "error"));
});
