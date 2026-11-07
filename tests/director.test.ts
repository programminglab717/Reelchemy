import { test } from "node:test";
import assert from "node:assert/strict";
import { directFilm, sceneProblems } from "../src/director/director";
import { parsePlan, parseScene } from "../src/director/prompts";
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
<html><div class="t">${label}</div><div class="dot"></div></html>
<css>#stage{background:#0b1020}.t{position:absolute;left:160px;top:200px;font:700 96px "Space Grotesk";color:#e2e8f0}.dot{position:absolute;left:160px;top:600px;width:80px;height:80px;border-radius:50%;background:#38bdf8}</css>
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
