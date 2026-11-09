import { test } from "node:test";
import assert from "node:assert/strict";
import { directFilm, frameFit, sceneProblems } from "../src/director/director";
import { previewMotionScene } from "../src/motion/preflight";
import {
  parsePlan,
  parseScene,
  plannerUser,
  writerUser,
} from "../src/director/prompts";
import type { Llm } from "../src/director/llm";
import { timelineSchema, totalFrames } from "../src/lib/schema";

const plan = {
  title: "Caching in 15 seconds",
  logline: "Why a cache makes reads fast.",
  style: {
    background: "#0b1020",
    surface: "#111a2e",
    text: "#e2e8f0",
    muted: "#94a3b8",
    accents: ["#38bdf8", "#f472b6"],
    displayFont: "Space Grotesk",
    bodyFont: "Inter",
    motion: "Snappy power3 entrances, glowing packets.",
    motifs: "Packets travelling along curved wires.",
  },
  scenes: [
    {
      title: "The slow trip",
      seconds: 7,
      goal: "Reads hit the database.",
      visual: "A request travels to a database.",
      onScreenText: ["Every read hits the database"],
      beats: [{ at: 0, do: "Request appears" }],
    },
    {
      title: "The cache",
      seconds: 7,
      goal: "A cache answers first.",
      visual: "A cache intercepts the request.",
      onScreenText: ["Cache hit"],
      beats: [{ at: 0, do: "Cache appears" }],
    },
  ],
};
const good = (label: string) => `<scene>
<html><div class="panel"></div><div class="t">${label}</div><div class="dot"></div></html>
<css>#stage{background:#0b1020}.panel{position:absolute;left:120px;top:120px;width:1680px;height:840px;border:2px solid #334155;border-radius:24px}.t{position:absolute;left:160px;top:200px;font:700 96px "Space Grotesk";color:#e2e8f0}.dot{position:absolute;left:160px;top:600px;width:80px;height:80px;border-radius:50%;background:#38bdf8}</css>
<js>gsap.timeline().from(".t",{opacity:0,y:40,duration:.8}).to(".dot",{x:1400,duration:5,ease:"none"},0);</js>
</scene>`;

test("plans are parsed leniently and their scene lengths made exact", () => {
  const parsed = parsePlan(
    "Here you go:\n" + JSON.stringify(plan) + "\nEnjoy",
    15,
  );
  assert.deepEqual(
    parsed.scenes.map((s) => Math.round(s.seconds * 30)),
    [225, 225],
  );
  const uneven = parsePlan(
    JSON.stringify({
      ...plan,
      scenes: [plan.scenes[0], { ...plan.scenes[1], seconds: 8.2 }],
    }),
    20,
  );
  assert.equal(
    uneven.scenes.reduce((n, s) => n + Math.round(s.seconds * 30), 0),
    600,
  );
  assert.throws(() => parsePlan("not json", 15));
  assert.throws(() =>
    parsePlan(JSON.stringify({ ...plan, scenes: [plan.scenes[0]] }), 120),
  );
});

test("scene replies are parsed from tagged parts, even with commentary", () => {
  const code = parseScene("Sure!\n```\n" + good("Hi") + "\n```");
  assert.equal(
    code !== "approved" && code.js.startsWith("gsap.timeline()"),
    true,
  );
  assert.equal(parseScene("<approved/>"), "approved");
  assert.deepEqual(
    parseScene("<scene><js>1;</js><libraries>d3, jquery</libraries></scene>"),
    { html: "", css: "", js: "1;", libraries: ["d3"] },
  );
  assert.throws(() => parseScene("<scene><html>x</html></scene>"));
});

test(
  "the director plans, writes, checks, reviews with stills and fixes broken scenes",
  { timeout: 180000 },
  async () => {
    const calls: { system: string; images: number; last: string }[] = [];
    const llm: Llm = async ({ system, messages }) => {
      const last = messages[messages.length - 1];
      const parts =
        typeof last.content === "string"
          ? [{ text: last.content }]
          : last.content;
      const text = parts.map((p) => ("text" in p ? p.text : "")).join("");
      calls.push({
        system,
        images: parts.filter((p) => "png" in p).length,
        last: text,
      });
      if (system.includes("creative director"))
        return { text: JSON.stringify(plan), truncated: false };
      const scene2 =
        text.includes('"number":2') ||
        messages[0].content.toString().includes('"number":2');
      if (text.startsWith("{"))
        // first request for a scene
        return {
          text: scene2
            ? good("Cache").replace(
                "gsap.timeline()",
                "missingFunction();gsap.timeline()",
              )
            : good("Database"),
          truncated: false,
        };
      // Review round.
      if (text.includes("JavaScript error"))
        return { text: good("Cache hit"), truncated: false };
      return { text: "<approved/>", truncated: false };
    };
    const stages: string[] = [];
    const result = await directFilm({
      brief: { prompt: "Explain caching", duration: 15, format: "landscape" },
      llm,
      vision: true,
      progress: (stage) => stages.push(stage),
    });
    assert.equal(timelineSchema.safeParse(result.timeline).success, true);
    assert.equal(totalFrames(result.timeline), 450);
    assert(result.timeline.scenes.every((s) => s.code && !s.layers.length));
    assert.equal(result.timeline.scenes[0].background, "#0b1020");
    assert.deepEqual(
      result.scenes.map((s) => [s.attempts, s.approved, s.fallback]),
      [
        [2, true, false],
        [3, true, false],
      ],
    );
    assert.match(result.timeline.scenes[1].code!.html, /Cache hit/);
    // Reviews carried stills and the error the check found.
    const reviews = calls.filter((c) => c.last.includes("Automatic checks"));
    assert(reviews.length >= 3);
    assert(reviews.every((c) => c.images === 1));
    assert(reviews.some((c) => /missingFunction/.test(c.last)));
    assert(stages[0].startsWith("Planning"));
    assert(stages.some((s) => s.startsWith("Reviewing scene 2")));
  },
);

test(
  "a scene that never parses falls back to a simple title scene instead of failing the film",
  { timeout: 120000 },
  async () => {
    const llm: Llm = async ({ system }) =>
      system.includes("creative director")
        ? {
            text: JSON.stringify({ ...plan, scenes: [plan.scenes[0]] }),
            truncated: false,
          }
        : { text: "I cannot do that.", truncated: false };
    const result = await directFilm({
      brief: { prompt: "Explain caching", duration: 6, format: "square" },
      llm,
      vision: false,
      maxRevisions: 1,
    });
    assert.equal(result.scenes[0].fallback, true);
    assert.match(result.timeline.scenes[0].code!.html, /The slow trip/);
    assert.equal(totalFrames(result.timeline), 180);
  },
);

test("problems name errors, empty frames and frozen scenes", () => {
  const frame = (time: number, detail: number, change: number | null) => ({
    time,
    detail,
    change,
    png: Buffer.alloc(0),
  });
  const problems = sceneProblems(
    {
      loaded: true,
      errors: ["ReferenceError: x is not defined\n at line 1"],
      layout: ["At 2.0s: Text #a overlaps text #b."],
      bounds: null,
      motion: [],
      coverage: [],
      stageArea: 1920 * 1080,
      frames: [
        frame(1, 10, null),
        frame(4, 0.5, 0.01),
        frame(6, 0.4, 0.01),
        frame(8, 0.4, 0.0),
      ],
    },
    8,
  );
  assert.deepEqual(problems, [
    "JavaScript error: ReferenceError: x is not defined |  at line 1",
    "The frame at 4.0s is empty.",
    "The frame at 6.0s is empty.",
    "The frame at 8.0s is empty.",
    "Nothing visibly moves between the sampled moments.",
    "At 2.0s: Text #a overlaps text #b.",
  ]);
});

test("problems name frozen stretches and underfilled frames, but not the final hold or 3D", () => {
  const motion = (changes: number[]) =>
    changes.map((change, i) => ({ time: (i + 1) * 0.5, change }));
  const box = (share: number) => ({
    x: 0,
    y: 0,
    w: 1920 * Math.sqrt(share),
    h: 1080 * Math.sqrt(share),
  });
  const preview = (
    changes: number[],
    shares: number[],
  ): Parameters<typeof sceneProblems>[0] => ({
    loaded: true,
    errors: [],
    layout: [],
    bounds: null,
    frames: [],
    motion: motion(changes),
    coverage: shares.map((share, i) => ({ time: 3 + i, bounds: box(share) })),
    stageArea: 1920 * 1080,
  });
  // 10 s: busy until 3 s, frozen 3–6.5 s, busy, then a still final hold.
  const changes = [
    2, 2, 1, 1, 0.5, 0.01, 0.02, 0, 0, 0, 0, 0.03, 1, 1, 1, 1, 1, 0, 0, 0,
  ];
  const problems = sceneProblems(preview(changes, [0.6, 0.6, 0.6]), 10);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /^From 2\.5s to 6\.0s nothing on screen changes/);
  // A short still final hold is expected.
  assert.deepEqual(
    sceneProblems(preview([...Array(17).fill(1), 0, 0, 0], [0.6]), 10),
    [],
  );
  const sparse = sceneProblems(
    preview(
      changes.map(() => 1),
      [0.2, 0.3, 0.5],
    ),
    10,
  );
  assert.equal(sparse.length, 1);
  assert.match(
    sparse[0],
    /^The frame is underfilled: at 3\.0s, 4\.0s .*\(20% at 3\.0s\)/,
  );
  // One sparse moment is not enough, and 3D canvases are not measured.
  assert.deepEqual(
    sceneProblems(
      preview(
        changes.map(() => 1),
        [0.2, 0.6, 0.6],
      ),
      10,
    ),
    [],
  );
  assert.deepEqual(
    sceneProblems(
      preview(
        changes.map(() => 1),
        [0.1, 0.1],
      ),
      10,
      { threeD: true },
    ),
    [],
  );
});

test("a fit brings overflowing content inside the stage and leaves fitting content alone", () => {
  const stage = { width: 1920, height: 1080 };
  assert.equal(frameFit({ x: 100, y: 100, w: 1600, h: 800 }, stage), undefined);
  // 2400 px wide content, starting at 100: scaled to fit within the margins.
  const fit = frameFit({ x: 100, y: 200, w: 2400, h: 600 }, stage)!;
  assert(Math.abs(fit.scale - 1792 / 2400) < 0.002);
  const left = 100 * fit.scale + fit.x,
    right = (100 + 2400) * fit.scale + fit.x;
  assert(left >= 63.5 && right <= 1920 - 63, `${left}..${right}`);
  // Content that only sticks out at the bottom moves up without shrinking.
  const shifted = frameFit({ x: 200, y: 700, w: 800, h: 500 }, stage)!;
  assert.equal(shifted.scale, 1);
  assert.equal(700 + shifted.y + 500, 1080 - 40);
});

test(
  "the director scales a scene whose finished composition overflows the frame",
  { timeout: 120000 },
  async () => {
    const wide = `<scene><html><div class="t">An extremely long headline that runs off the frame</div></html>
<css>#stage{background:#0b1020}.t{position:absolute;left:300px;top:400px;white-space:nowrap;font:700 110px "Space Grotesk";color:#fff}</css>
<js>gsap.from(".t",{opacity:0,duration:.5});</js></scene>`;
    const llm: Llm = async ({ system }) =>
      system.includes("creative director")
        ? {
            text: JSON.stringify({ ...plan, scenes: [plan.scenes[0]] }),
            truncated: false,
          }
        : { text: wide, truncated: false };
    const result = await directFilm({
      brief: { prompt: "Explain caching", duration: 6, format: "landscape" },
      llm,
      vision: false,
      maxRevisions: 0,
    });
    const code = result.timeline.scenes[0].code!;
    assert(code.fit && code.fit.scale < 0.8, JSON.stringify(code.fit));
    assert.equal(result.scenes[0].fitted, true);
    const check = await previewMotionScene({
      code,
      format: "landscape",
      durationSeconds: 6,
      times: [5.5],
      boundsAt: 5.5,
      auditAt: [5.5],
    });
    assert.deepEqual(check.errors, []);
    const b = check.bounds!;
    assert(
      b.x >= 0 && b.x + b.w <= 1920 && b.y >= 0 && b.y + b.h <= 1080,
      JSON.stringify(b),
    );
    assert(
      !check.layout.some((note) => /outside the stage/.test(note)),
      check.layout.join(" / "),
    );
  },
);

test("a style preset's direction reaches the planner and the writer", () => {
  const direction = "Typography is the visual.";
  assert.equal(
    JSON.parse(
      plannerUser(
        { prompt: "x", duration: 10, format: "landscape" },
        { direction },
      ),
    ).styleDirection,
    direction,
  );
  const film = parsePlan(JSON.stringify(plan), 14);
  assert.equal(
    JSON.parse(writerUser(film, 0, "landscape", [], direction)).film
      .styleDirection,
    direction,
  );
});
