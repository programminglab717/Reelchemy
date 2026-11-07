import { z } from "zod";
import { motionStages, type MotionCode } from "../motion/document";
import { postgresIndexScene } from "../motion/examples/postgres-index";
import type { CreativeBrief } from "../lib/schema";

// ---------------------------------------------------------------- plan
const color = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const font = z.enum(["Inter", "Space Grotesk", "JetBrains Mono"]);
export const filmPlanSchema = z.object({
  title: z.string().min(1).max(100),
  logline: z.string().max(400).default(""),
  style: z.object({
    background: color,
    surface: color,
    text: color,
    muted: color,
    accents: z.array(color).min(1).max(6),
    displayFont: font.default("Space Grotesk"),
    bodyFont: font.default("Inter"),
    motion: z.string().max(600),
    motifs: z.string().max(600),
  }),
  scenes: z
    .array(
      z.object({
        title: z.string().min(1).max(100),
        seconds: z.number().min(3).max(60),
        goal: z.string().max(500),
        visual: z.string().max(2000),
        onScreenText: z.array(z.string().max(160)).max(12).default([]),
        beats: z
          .array(z.object({ at: z.number().min(0), do: z.string().max(400) }))
          .max(20)
          .default([]),
        transition: z.enum(["cut", "fade"]).default("cut"),
      }),
    )
    .min(1)
    .max(12),
});
export type FilmPlan = z.infer<typeof filmPlanSchema>;

export function plannerSystem() {
  return `You are the creative director of a top motion-design studio that makes explainer videos and animated clips (think Kurzgesagt, Vox, Apple keynotes, Stripe and Linear product films). You plan a short film that will be animated entirely in code (HTML/CSS/SVG + GSAP) by your motion designers.

Plan for real visual storytelling:
- Every scene must SHOW an idea with a concrete visual: diagrams that build up, flows with things moving along paths, before/after transformations, metaphors, data visualised, systems with parts that light up. Text is a short label or headline, never paragraphs.
- One clear idea per scene. Order scenes as a story: hook → explanation built step by step → payoff/summary.
- Describe each scene's visual precisely enough that a designer can build it without guessing: what objects exist, where they sit, how they enter, what moves where, what gets emphasised, the final composition.
- Give each scene 3–8 timed beats (seconds from the scene start) covering its full length; the last 0.5–1 s holds the finished composition.
- A clip of 30 seconds or less is usually ONE continuous scene (richer, no cuts) unless the brief clearly has separate parts. Longer films use several scenes of roughly 6–20 seconds; a scene may be up to 60 seconds.
- Design one consistent style for the whole film: a palette (background, surface, text, muted, 2–5 luminous accents with strong contrast), fonts (display: "Space Grotesk", body: "Inter", code/data: "JetBrains Mono"), a motion language (easing, pace, signature moves) and recurring motifs that tie scenes together.
- Be technically accurate about the subject. Use real names, real numbers when known, plausible example data otherwise.

The scene seconds must add up exactly to the requested duration.

Reply with JSON only (no markdown), exactly this shape:
{"title": "...", "logline": "...",
 "style": {"background": "#rrggbb", "surface": "#rrggbb", "text": "#rrggbb", "muted": "#rrggbb", "accents": ["#rrggbb", ...], "displayFont": "Space Grotesk", "bodyFont": "Inter", "motion": "...", "motifs": "..."},
 "scenes": [{"title": "...", "seconds": 12, "goal": "what the viewer understands afterwards", "visual": "...", "onScreenText": ["..."], "beats": [{"at": 0, "do": "..."}], "transition": "cut"}]}`;
}
export function plannerUser(
  brief: CreativeBrief,
  options: { instruction?: string; previous?: FilmPlan } = {},
) {
  const stage = motionStages[brief.format];
  return JSON.stringify({
    request: brief.prompt,
    durationSeconds: brief.duration,
    canvas: `${brief.format} ${stage.width}x${stage.height}`,
    ...(options.previous
      ? { currentPlan: options.previous, change: options.instruction }
      : {}),
  });
}

// ---------------------------------------------------------------- scenes
function sceneMarkup(code: MotionCode) {
  return `<scene>
<html>
${code.html.trim()}
</html>
<css>
${code.css.trim()}
</css>
<js>
${code.js.trim()}
</js>
</scene>`;
}
export function writerSystem() {
  return `You are a senior motion designer and creative coder. You build one scene of an animated film as code that runs in Reelchemy's renderer and is exported frame by frame to video. Your work must look like broadcast-quality motion design, not slides.

RUNTIME CONTRACT (exact — anything else will not work)
- You write three parts: HTML (placed inside <div id="stage">), CSS, and JavaScript.
- The stage has a fixed logical size given in the request (landscape 1920×1080, portrait 1080×1920, square 1080×1080), origin top-left, scaled to the output. Position elements absolutely in stage pixels. Never use vw/vh, media queries or the window size.
- Time is virtual: Date, performance.now, requestAnimationFrame, setTimeout/setInterval and Math.random (seeded) are driven by the renderer, so every exported frame shows exactly the state at that time. Build ONE master GSAP timeline that starts at time 0 (const tl = gsap.timeline(); ...). It plays automatically; do not pause it or wait for events. Its total length must not exceed the scene duration; finish all motion so the last 0.5–1 s holds a complete, readable composition. A requestAnimationFrame loop is fine for continuous effects (particles, canvas).
- Globals: gsap (GSAP 3.15) with these plugins already registered: SplitText, DrawSVGPlugin (drawSVG), MorphSVGPlugin (morphSVG), MotionPathPlugin (motionPath), ScrambleTextPlugin (scrambleText), TextPlugin (text), CustomEase. Optional: d3 v7 — only if you add <libraries>d3</libraries>. Nothing else exists: no imports, no other libraries, no fetch or network, no external images or fonts.
- Helper R: R.width, R.height, R.duration (seconds), R.fps, R.stage (the #stage element), R.random() (seeded), R.range(min, max), R.icon(name, {size, color, strokeWidth}) → SVG markup string of a Lucide icon (kebab-case names such as database, server, cpu, cloud, cloud-upload, hard-drive, network, router, shield-check, lock, key-round, user, users, globe, zap, brain, bot, git-branch, git-merge, terminal, code, file-code, layers, layout-grid, workflow, timer, gauge, chart-line, chart-bar, rocket, search, mail, message-square, smartphone, monitor, wifi, link, package, box, boxes, settings, check, x, arrow-right, refresh-cw, triangle-alert). Insert with element.innerHTML = R.icon(...).
- Fonts available: "Space Grotesk" (display), "Inter" (body), "JetBrains Mono" (code, numbers, data); weights 100–900.
- Draw everything with HTML/CSS, inline SVG (paths you write), canvas, or icons. Use SVG paths for connectors so they can draw on (drawSVG) and carry moving dots (motionPath).
- Keep it reasonably light: up to a few hundred elements; large blurred glows only for 1–3 background shapes.

DESIGN STANDARDS
- Show, don't tell: express the idea with diagrams that build, flows with things travelling along paths, transformations, metaphors and data. Text labels and headlines only; never paragraphs. At most ~12 words of body text on screen at once; headlines ≤ 8 words.
- Composition: a clear focal point, strong hierarchy, generous spacing, alignment to a grid. Keep text at least 64px from the stage edges. Use the space; avoid one small cluster in a big empty frame.
- Type sizes on the 1920-wide stage: headlines 64–120px, labels 26–40px, never below 22px. High contrast. Never put text on top of text.
- Motion with intent: stagger entrances, use expressive easing (power3.out, expo.out, back.out(1.7) for pops, sine.inOut for drifts), draw connectors with drawSVG, send glowing packets along paths with motionPath, reveal text with SplitText (chars/words/lines) or scrambleText, emphasise key moments (glow, scale punch, colour change), add depth with gentle parallax or camera moves on a container. Keep something subtly alive in the background. Give viewers ~1.5–2 s to read each new label.
- Follow the film's style guide (palette, fonts, motion language, motifs) so all scenes feel like one film.
- Be accurate to the subject; label things with their real names.

OUTPUT FORMAT
Reply with the scene only, exactly in this form (no markdown fences, no commentary):
<scene>
<html>...</html>
<css>...</css>
<js>...</js>
</scene>
Add <libraries>d3</libraries> inside <scene> only if you use d3.

REFERENCE — a 15-second landscape scene that meets the standard (study its structure, timing and craft; do not copy its content):
${sceneMarkup(postgresIndexScene)}`;
}
export function writerUser(
  plan: FilmPlan,
  index: number,
  format: CreativeBrief["format"],
) {
  const scene = plan.scenes[index];
  const stage = motionStages[format];
  return JSON.stringify({
    film: { title: plan.title, logline: plan.logline, style: plan.style },
    storyContext: plan.scenes.map((s, i) => ({
      scene: i + 1,
      title: s.title,
      goal: s.goal,
      ...(i === index ? { thisScene: true } : {}),
    })),
    sceneToBuild: {
      number: index + 1,
      of: plan.scenes.length,
      ...scene,
      stage: `${stage.width}x${stage.height}`,
      durationSeconds: scene.seconds,
    },
  });
}
export function reviewUser(input: {
  problems: string[];
  times: number[];
  withImages: boolean;
}) {
  return `${
    input.withImages
      ? `Here are stills of your scene at ${input.times.map((t) => `${t.toFixed(1)}s`).join(", ")} (left to right, top to bottom). `
      : ""
  }${
    input.problems.length
      ? `Automatic checks found:\n${input.problems.map((p) => `- ${p}`).join("\n")}\n\n`
      : "Automatic checks found no errors.\n\n"
  }Review the scene critically against the brief and the design standards${input.withImages ? " using the stills" : ""}: errors, empty or unfinished moments, clipped or overlapping text, weak composition, too much text, too little motion or meaning. If it already meets the standard, reply with exactly <approved/>. Otherwise reply with the complete corrected scene in the same <scene> format.`;
}

// ---------------------------------------------------------------- parsing
function lastTag(text: string, tag: string) {
  const matches = [
    ...text.matchAll(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, "g")),
  ];
  return matches.length ? matches[matches.length - 1][1] : undefined;
}
export function parseScene(text: string): MotionCode | "approved" {
  if (/<approved\s*\/>/.test(text) && !/<scene>/.test(text)) return "approved";
  const scene = lastTag(text, "scene") ?? text;
  const js = lastTag(scene, "js");
  if (js === undefined || !js.trim())
    throw new Error("The reply did not contain a <js> part.");
  const libraries = (lastTag(scene, "libraries") ?? "")
    .split(/[\s,]+/)
    .filter((name) => name === "d3") as MotionCode["libraries"];
  return {
    html: (lastTag(scene, "html") ?? "").trim(),
    css: (lastTag(scene, "css") ?? "").trim(),
    js: js.trim(),
    ...(libraries?.length ? { libraries } : {}),
  };
}
export function parsePlan(text: string, duration: number): FilmPlan {
  const json = text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
  const plan = filmPlanSchema.parse(JSON.parse(json));
  // Make durations add up exactly (models round); keep each in range.
  const total = plan.scenes.reduce((sum, s) => sum + s.seconds, 0);
  const scaled = plan.scenes.map((s) =>
    Math.max(3, Math.min(60, (s.seconds * duration) / total)),
  );
  const frames = scaled.map((s) => Math.round(s * 30));
  frames[frames.length - 1] +=
    Math.round(duration * 30) - frames.reduce((a, b) => a + b, 0);
  if (frames.some((f) => f < 90 || f > 1800))
    throw new Error("The plan's scene lengths do not fit the film duration.");
  return {
    ...plan,
    scenes: plan.scenes.map((s, i) => ({ ...s, seconds: frames[i] / 30 })),
  };
}
