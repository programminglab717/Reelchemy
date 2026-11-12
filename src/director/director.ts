import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { z } from "zod";
import {
  timelineSchema,
  type CreativeBrief,
  type Scene,
  type Timeline,
} from "../lib/schema";
import { motionStages, type MotionCode } from "../motion/document";
import { previewMotionScene, type MotionPreview } from "../motion/preflight";
import type { DirectorReference } from "./reference";
import type { Llm, LlmMessage } from "./llm";
import {
  parsePlan,
  parseScene,
  plannerSystem,
  plannerUser,
  reviewUser,
  writerSystem,
  writerUser,
  type FilmPlan,
  type ProjectImage,
} from "./prompts";

export type SceneReport = {
  title: string;
  attempts: number;
  approved: boolean;
  // Problems still present in the scene that was kept.
  remaining: string[];
  fallback: boolean;
  // The scene's content was scaled to fit the frame.
  fitted?: boolean;
};
export type DirectorResult = {
  timeline: Timeline;
  plan: FilmPlan;
  scenes: SceneReport[];
};
export type DirectorOptions = {
  brief: CreativeBrief;
  llm: Llm;
  // Whether the model accepts images (stills are sent for visual review).
  vision: boolean;
  progress?: (stage: string, fraction: number) => void;
  signal?: AbortSignal;
  concurrency?: number;
  maxRevisions?: number;
  // A creative direction from a style preset.
  direction?: string;
  // A style reference to match (frames and pacing notes).
  reference?: DirectorReference;
  // The project's images the scenes may use, with their bytes for previews.
  images?: (ProjectImage & { bytes: Buffer })[];
  // Injectable for tests.
  preview?: typeof previewMotionScene;
};

// A request's first message, with the style reference when there is one:
// its frames for models that see images, and its pacing notes for all.
function withReference(
  text: string,
  options: Pick<DirectorOptions, "reference" | "vision">,
): LlmMessage["content"] {
  const reference = options.reference;
  if (!reference) return text;
  const note = `\n\nSTYLE REFERENCE (match its look, typography, palette, materials, motion language and pacing; never copy its content, logos or words): ${reference.notes}`;
  return options.vision
    ? [{ png: reference.sheet }, { text: text + note }]
    : text + note.replace(/ The attached sheet[^.]*\./, "");
}
const PLAN_TOKENS = 6000;
const SCENE_TOKENS = 16000;

// The scale and offset (stage pixels) that bring content inside the stage
// with a margin, or undefined when it already fits. Content keeps its place
// where it can and is never enlarged.
export function frameFit(
  bounds: { x: number; y: number; w: number; h: number },
  stage: { width: number; height: number },
  // The layout audit's safe margins for text.
  margin = { x: 64, y: 40 },
) {
  const inside =
    bounds.x >= -1 &&
    bounds.y >= -1 &&
    bounds.x + bounds.w <= stage.width + 1 &&
    bounds.y + bounds.h <= stage.height + 1;
  if (inside) return undefined;
  const scale = Math.max(
    0.3,
    Math.min(
      1,
      (stage.width - margin.x * 2) / bounds.w,
      (stage.height - margin.y * 2) / bounds.h,
    ),
  );
  const place = (start: number, size: number, room: number, edge: number) =>
    Math.min(Math.max(start, edge), room - edge - size * scale) - start * scale;
  return {
    scale: Math.floor(scale * 1000) / 1000,
    x: Math.round(place(bounds.x, bounds.w, stage.width, margin.x)),
    y: Math.round(place(bounds.y, bounds.h, stage.height, margin.y)),
  };
}
// Times to sample a scene of `seconds` for review stills.
export function reviewTimes(seconds: number) {
  return [0.12, 0.28, 0.45, 0.62, 0.8, 1].map(
    (f) => Math.round(seconds * f * 30) / 30,
  );
}
// Moments sampled to measure motion (every half second) and how much of the
// frame the content covers (every second after the opening).
export function motionProbeTimes(seconds: number) {
  return Array.from(
    { length: Math.floor(seconds * 2) + 1 },
    (_, i) => Math.round(i * 15) / 30,
  ).filter((t) => t <= seconds);
}
// Moments at which the layout is audited: the review stills after the first,
// and every whole second, so a collision between two stills is still seen.
export function auditTimes(seconds: number, stills: number[]) {
  const times = new Set(stills.slice(1));
  for (let t = 1; t <= seconds - 0.5; t++) times.add(t);
  return [...times].sort((a, b) => a - b);
}
export function coverageTimes(seconds: number) {
  const times: number[] = [];
  for (let t = Math.max(1, seconds * 0.3); t <= seconds - 0.5; t += 1)
    times.push(Math.round(t * 30) / 30);
  return times;
}
// Mean pixel change below which a half-second interval reads as frozen.
const STILL = 0.06;
// Frozen stretches longer than this (outside the final hold) are reported.
const LONGEST_STILL = 2.5;
// Content covering less of the frame than this reads as underfilled.
const MIN_COVERAGE = 0.4;
// Stretches where nothing on screen changes (ambience excluded), as
// [from, to] seconds, ignoring the final hold.
export function stillStretches(
  motion: { time: number; change: number }[],
  seconds: number,
) {
  const stretches: [number, number][] = [];
  let start: number | null = null,
    previous = 0;
  const end = seconds - 1.2;
  for (const sample of motion) {
    if (sample.time > end) break;
    if (sample.change < STILL) {
      if (start === null) start = previous;
    } else if (start !== null) {
      stretches.push([start, previous]);
      start = null;
    }
    previous = sample.time;
  }
  if (start !== null) stretches.push([start, previous]);
  return stretches.filter(([a, b]) => b - a >= LONGEST_STILL);
}
// Problems an automatic pass can find, in words a model can act on.
export function sceneProblems(
  preview: MotionPreview,
  seconds: number,
  options: { threeD?: boolean } = {},
) {
  const problems = [...new Set(preview.errors)].map(
    (error) => `JavaScript error: ${error.split("\n").slice(0, 3).join(" | ")}`,
  );
  if (!preview.loaded) problems.push("The scene did not finish loading.");
  for (const frame of preview.frames)
    if (frame.time >= seconds * 0.25 && frame.detail < 2)
      problems.push(`The frame at ${frame.time.toFixed(1)}s is empty.`);
  const changes = preview.frames
    .map((frame) => frame.change)
    .filter((change): change is number => change !== null);
  if (changes.length >= 3 && changes.every((change) => change < 0.05))
    problems.push("Nothing visibly moves between the sampled moments.");
  for (const [from, to] of stillStretches(preview.motion ?? [], seconds))
    problems.push(
      `From ${from.toFixed(1)}s to ${to.toFixed(1)}s nothing on screen changes (${(to - from).toFixed(1)}s, background ambience aside). Keep the frame alive: a new visual event at least every 1.5–2 s (a reveal, a callout, a packet, a highlight, a camera move or a shot change).`,
    );
  // Coverage is measured from the page's elements; a 3D canvas is not.
  if (!options.threeD) {
    const sparse = (preview.coverage ?? []).filter((c) => {
      const area = c.bounds ? c.bounds.w * c.bounds.h : 0;
      return area < MIN_COVERAGE * (preview.stageArea ?? Infinity);
    });
    if (preview.stageArea && sparse.length >= 2) {
      const worst = sparse.reduce((a, b) =>
        (a.bounds ? a.bounds.w * a.bounds.h : 0) <=
        (b.bounds ? b.bounds.w * b.bounds.h : 0)
          ? a
          : b,
      );
      const share = worst.bounds
        ? Math.round(
            (100 * worst.bounds.w * worst.bounds.h) / preview.stageArea,
          )
        : 0;
      problems.push(
        `The frame is underfilled: at ${sparse.map((c) => c.time.toFixed(1) + "s").join(", ")} the content covers less than ${Math.round(MIN_COVERAGE * 100)}% of the frame (${share}% at ${worst.time.toFixed(1)}s). Make the main visual span most of the stage: larger nodes, cards and type, more of the story on screen, or move the camera in.`,
      );
    }
  }
  return [...problems, ...preview.layout];
}
async function reviewSheet(preview: MotionPreview) {
  const frames = preview.frames;
  const meta = await sharp(frames[0].png).metadata();
  const columns = meta.width! > meta.height! ? 2 : 3;
  const width = meta.width!,
    height = meta.height!,
    gap = 6,
    rows = Math.ceil(frames.length / columns);
  return sharp({
    create: {
      width: columns * width + (columns - 1) * gap,
      height: rows * height + (rows - 1) * gap,
      channels: 3,
      background: "#3a3a3a",
    },
  })
    .composite(
      frames.map((frame, i) => ({
        input: frame.png,
        left: (i % columns) * (width + gap),
        top: Math.floor(i / columns) * (height + gap),
      })),
    )
    .png()
    .toBuffer();
}
async function inParallel<T, R>(
  items: T[],
  limit: number,
  run: (item: T, index: number) => Promise<R>,
) {
  const results: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const index = next++;
        results[index] = await run(items[index], index);
      }
    }),
  );
  return results;
}
// A simple, valid scene used when a scene cannot be written.
function fallbackScene(plan: FilmPlan, index: number): MotionCode {
  const scene = plan.scenes[index];
  const accent = plan.style.accents[0];
  const escape = (text: string) =>
    text.replace(
      /[&<>]/g,
      (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!,
    );
  return {
    html: `<div class="wrap"><div class="kicker">${escape(plan.title)}</div><div class="title">${escape(scene.title)}</div><div class="goal">${escape(scene.onScreenText[0] ?? scene.goal)}</div></div>`,
    css: `#stage{background:${plan.style.background};color:${plan.style.text}}
.wrap{position:absolute;left:12%;right:12%;top:50%;transform:translateY(-50%)}
.kicker{font:600 30px "JetBrains Mono";letter-spacing:.2em;text-transform:uppercase;color:${accent}}
.title{font:700 96px/1.05 "${plan.style.displayFont}";margin:28px 0}
.goal{font:400 38px/1.4 "${plan.style.bodyFont}";color:${plan.style.muted};max-width:1100px}`,
    js: `gsap.timeline().from(".kicker",{opacity:0,y:20,duration:.6,ease:"power3.out"}).from(new SplitText(".title",{type:"words"}).words,{opacity:0,y:60,stagger:.08,duration:.7,ease:"power3.out"},.2).from(".goal",{opacity:0,y:20,duration:.8,ease:"power2.out"},.7);`,
  };
}

type SceneContext = {
  brief: CreativeBrief;
  llm: Llm;
  vision: boolean;
  signal?: AbortSignal;
  preview: typeof previewMotionScene;
  maxRevisions: number;
  images: (ProjectImage & { bytes: Buffer })[];
  reference?: DirectorReference;
  // Reports a step within this scene (0 = started, 1 = done).
  step: (stage: string, within: number) => void;
};
// Writes (or rewrites) one scene: generate, preview and audit, then review
// with the model until it approves or the revision limit is reached. Keeps
// the attempt with the fewest problems.
async function writeScene(
  context: SceneContext,
  plan: FilmPlan,
  index: number,
  messages: LlmMessage[],
): Promise<{ code: MotionCode; report: SceneReport }> {
  const { llm, signal } = context;
  const scene = plan.scenes[index];
  let code: MotionCode | undefined;
  let best:
    | { code: MotionCode; problems: string[]; bounds: MotionPreview["bounds"] }
    | undefined;
  let approved = false,
    attempts = 0;
  context.step("Writing", 0);
  for (let round = 0; round <= context.maxRevisions; round++) {
    signal?.throwIfAborted();
    attempts++;
    const reply = await llm({
      system: writerSystem(),
      messages,
      maxTokens: SCENE_TOKENS,
      signal,
    });
    messages.push({ role: "assistant", content: reply.text || "(empty)" });
    let parsed: MotionCode | "approved";
    try {
      if (reply.truncated) throw new Error("cut off");
      parsed = parseScene(reply.text);
    } catch {
      messages.push({
        role: "user",
        content: reply.truncated
          ? "Your reply was cut off before the end. Reply with a more compact version of the complete scene in the <scene> format."
          : "Your reply did not follow the <scene><html>…</html><css>…</css><js>…</js></scene> format. Reply with the complete scene in that format.",
      });
      continue;
    }
    if (parsed === "approved") {
      if (code) approved = true;
      break;
    }
    // The scene declares exactly the project images its code mentions.
    const used = context.images
      .filter((image) =>
        [parsed.html, parsed.css, parsed.js].some((part) =>
          part.includes(image.id),
        ),
      )
      .map((image) => image.id)
      .slice(0, 12);
    code = used.length ? { ...parsed, assets: used } : parsed;
    context.step("Checking", 0.5);
    const times = reviewTimes(scene.seconds);
    const result = await context.preview({
      code,
      format: context.brief.format,
      durationSeconds: scene.seconds,
      times,
      probeTimes: motionProbeTimes(scene.seconds),
      coverageAt: coverageTimes(scene.seconds),
      auditAt: auditTimes(scene.seconds, times),
      // The finished composition, before any closing exit.
      boundsAt: Math.max(0, scene.seconds - 0.5),
      assets: Object.fromEntries(
        context.images
          .filter((image) => code!.assets?.includes(image.id))
          .map((image) => [
            image.id,
            { bytes: image.bytes, type: "image/png" },
          ]),
      ),
    });
    const problems = sceneProblems(result, scene.seconds, {
      threeD: !!code.libraries?.includes("three"),
    });
    if (!best || problems.length <= best.problems.length)
      best = { code, problems, bounds: result.bounds ?? null };
    // Clean, and no images to judge by: accept without another call.
    if (
      round === context.maxRevisions ||
      (!problems.length && !context.vision)
    ) {
      approved = !problems.length;
      break;
    }
    const withImages = context.vision && result.frames.length > 0;
    messages.push({
      role: "user",
      content: [
        ...(withImages ? [{ png: await reviewSheet(result) }] : []),
        {
          text: reviewUser({
            problems,
            times: result.frames.map((frame) => frame.time),
            withImages,
          }),
        },
      ],
    });
    context.step("Reviewing", 0.7);
  }
  const kept = best ?? {
    code: fallbackScene(plan, index),
    problems: [],
    bounds: null,
  };
  // Whatever the model did, the finished composition fits the frame.
  const fit = kept.bounds
    ? frameFit(kept.bounds, motionStages[context.brief.format])
    : undefined;
  if (fit) kept.code = { ...kept.code, fit };
  return {
    code: kept.code,
    report: {
      title: scene.title,
      attempts,
      approved: approved && !!best && !best.problems.length,
      remaining: kept.problems,
      fallback: !best,
      fitted: !!fit,
    },
  };
}
function sceneContext(options: DirectorOptions): Omit<SceneContext, "step"> {
  return {
    brief: options.brief,
    llm: options.llm,
    vision: options.vision,
    signal: options.signal,
    preview: options.preview ?? previewMotionScene,
    maxRevisions: options.maxRevisions ?? 2,
    images: options.images ?? [],
    reference: options.reference,
  };
}
// What was wrong with a plan, in words the model can act on.
function planProblem(error: unknown) {
  if (error instanceof z.ZodError)
    return error.issues
      .slice(0, 6)
      .map((issue) => `${issue.path.join(".") || "plan"}: ${issue.message}`)
      .join("; ");
  if (error instanceof SyntaxError) return "it is not valid JSON";
  return error instanceof Error ? error.message.slice(0, 300) : "invalid";
}
async function planFilm(
  options: DirectorOptions & { previous?: FilmPlan; instruction?: string },
) {
  const { brief, llm, signal } = options;
  const messages: LlmMessage[] = [
    {
      role: "user",
      content: withReference(
        plannerUser(brief, {
          previous: options.previous,
          instruction: options.instruction,
          images: options.images,
          direction: options.direction,
        }),
        options,
      ),
    },
  ];
  for (let attempt = 0; ; attempt++) {
    const reply = await llm({
      system: plannerSystem(),
      messages,
      maxTokens: PLAN_TOKENS,
      signal,
    });
    try {
      return parsePlan(reply.text, brief.duration);
    } catch (error) {
      if (attempt >= 2)
        throw new Error("The director could not produce a valid plan.");
      messages.push(
        { role: "assistant", content: reply.text || "(empty)" },
        {
          role: "user",
          content: `That plan could not be used (${planProblem(error)}). Reply with the complete plan as valid JSON only, with scene seconds adding up to ${brief.duration}.`,
        },
      );
    }
  }
}
export function codeSceneFromPlan(
  plan: FilmPlan,
  index: number,
  code: MotionCode,
): Scene {
  const scene = plan.scenes[index];
  return {
    id: `scene-${index + 1}-${randomUUID().slice(0, 8)}`,
    title: scene.title.slice(0, 100),
    intent: scene.goal.slice(0, 500),
    durationFrames: Math.round(scene.seconds * 30),
    background: plan.style.background,
    accent: plan.style.accents[0],
    strategy: "diagram",
    layers: [],
    transition: scene.transition,
    code,
  };
}
// A whole film: storyboard and style, then every scene. With `previous` and
// `instruction`, the storyboard is revised rather than started fresh.
export async function directFilm(
  options: DirectorOptions & { previous?: FilmPlan; instruction?: string },
): Promise<DirectorResult> {
  const progress = options.progress ?? (() => {});
  progress(
    options.previous ? "Revising the storyboard" : "Planning the storyboard",
    0.02,
  );
  const film = await planFilm(options);
  const base = sceneContext(options);
  const total = film.scenes.length;
  const share = new Array(total).fill(0);
  const report = () => 0.08 + (0.88 * share.reduce((a, b) => a + b, 0)) / total;
  const scenes = await inParallel(
    film.scenes,
    Math.max(1, options.concurrency ?? 1),
    async (scene, index) => {
      const result = await writeScene(
        {
          ...base,
          step: (stage, within) => {
            share[index] = within;
            progress(
              `${stage} scene ${index + 1} of ${total}: ${scene.title}`,
              report(),
            );
          },
        },
        film,
        index,
        [
          {
            role: "user",
            content: withReference(
              writerUser(
                film,
                index,
                options.brief.format,
                options.images,
                options.direction,
              ),
              options,
            ),
          },
        ],
      );
      share[index] = 1;
      return result;
    },
  );
  progress("Assembling the film", 0.97);
  const timeline: Timeline = timelineSchema.parse({
    fps: 30,
    format: options.brief.format,
    scenes: film.scenes.map((_, index) =>
      codeSceneFromPlan(film, index, scenes[index].code),
    ),
  });
  return { timeline, plan: film, scenes: scenes.map((s) => s.report) };
}
// Rewrites one existing code scene from an instruction, keeping its length.
export async function directScene(
  options: DirectorOptions & {
    plan: FilmPlan;
    index: number;
    current: MotionCode;
    instruction: string;
  },
) {
  const progress = options.progress ?? (() => {});
  return writeScene(
    {
      ...sceneContext(options),
      step: (stage, within) =>
        progress(`${stage} the scene`, 0.05 + 0.9 * within),
    },
    options.plan,
    options.index,
    [
      {
        role: "user",
        content: withReference(
          `${writerUser(options.plan, options.index, options.brief.format, options.images, options.direction)}

Current version of this scene:
<scene>
<html>
${options.current.html}
</html>
<css>
${options.current.css}
</css>
<js>
${options.current.js}
</js>
</scene>

Requested change: ${options.instruction}

Reply with the complete updated scene in the <scene> format, keeping its duration and the film's style.`,
          options,
        ),
      },
    ],
  );
}
