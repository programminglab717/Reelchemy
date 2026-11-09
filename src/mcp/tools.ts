import { readFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { z } from "zod";
import { internalRequest, type Access } from "@/lib/access";
import { assetDir } from "@/lib/assets";
import { takeRequestLimit } from "@/lib/db";
import { revisionId } from "@/lib/editor";
import { limitsPolicy, RequestRateError } from "@/lib/limits-policy";
import {
  MAX_CODE_SCENE_FRAMES,
  motionCodeSchema,
  type Project,
  type Scene,
  type Timeline,
} from "@/lib/schema";
import { motionStages, type MotionCode } from "@/motion/document";
import { contactSheet, previewMotionScene } from "@/motion/preflight";
import {
  coverageTimes,
  motionProbeTimes,
  reviewTimes,
  sceneProblems,
} from "@/director/director";
import { directorPresetIds } from "@/director/presets";
import { motionGuide } from "@/director/prompts";
import * as projectsRoute from "@/app/api/projects/route";
import * as projectRoute from "@/app/api/projects/[id]/route";
import * as directRoute from "@/app/api/projects/[id]/direct/route";
import * as renderRoute from "@/app/api/projects/[id]/render/route";
import * as jobRoute from "@/app/api/jobs/[id]/route";

// Tools an assistant uses to make videos in the studio. Each one goes
// through the studio's own API handlers for the token's studio (ownership,
// validation, revision checks and limits are the same as in the browser),
// or through the same preflight the AI director uses.
export type ToolContent =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: string };
export type ToolResult = {
  content: ToolContent[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
};
export class ToolError extends Error {}
export type McpContext = { access: Access; origin: string };
type Route = (
  req: Request,
  context: { params: Promise<Record<string, string>> },
) => Promise<Response> | Response;

async function call(
  ctx: McpContext,
  route: Route,
  method: string,
  pathname: string,
  options: { body?: unknown; params?: Record<string, string> } = {},
) {
  const request = internalRequest(
    new Request(new URL(pathname, ctx.origin), {
      method,
      headers: { "content-type": "application/json" },
      ...(options.body === undefined
        ? {}
        : { body: JSON.stringify(options.body) }),
    }),
    ctx.access,
  );
  const response = await route(request, {
    params: Promise.resolve(options.params ?? {}),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok)
    throw new ToolError(
      (data && typeof data.error === "string" && data.error) ||
        `The studio refused the request (HTTP ${response.status}).`,
    );
  return data;
}
const getProject = async (ctx: McpContext, id: string) =>
  (await call(ctx, projectRoute.GET as Route, "GET", `/api/projects/${id}`, {
    params: { id },
  })) as Project;
async function saveTimeline(
  ctx: McpContext,
  project: Project,
  timeline: Timeline,
) {
  return (await call(
    ctx,
    projectRoute.PATCH as Route,
    "PATCH",
    `/api/projects/${project.id}`,
    {
      params: { id: project.id },
      body: { timeline, baseRevisionId: revisionId(project) },
    },
  )) as Project;
}
function sceneAt(project: Project, index: number) {
  const scene = project.timeline?.scenes[index];
  if (!project.timeline || !scene)
    throw new ToolError(
      `Scene ${index} does not exist; the project has ${project.timeline?.scenes.length ?? 0} scenes (0-based).`,
    );
  return { timeline: project.timeline, scene };
}
// Shifting scenes would move narration and captions; keep that in the studio.
function assertNoTimedMedia(timeline: Timeline) {
  if (
    (timeline.audioTracks?.length ?? 0) > 0 ||
    (timeline.captions?.length ?? 0) > 0
  )
    throw new ToolError(
      "This film has audio or captions placed on its timeline. Change scene lengths in the studio so they stay in sync.",
    );
}
const summary = (project: Project) => ({
  projectId: project.id,
  name: project.name ?? project.brief?.prompt ?? "Untitled",
  format: project.timeline?.format ?? project.brief?.format,
  revisionId: revisionId(project),
  seconds: project.timeline
    ? project.timeline.scenes.reduce((n, s) => n + s.durationFrames, 0) / 30
    : 0,
  scenes: (project.timeline?.scenes ?? []).map((scene, index) => ({
    index,
    id: scene.id,
    title: scene.title,
    seconds: scene.durationFrames / 30,
    kind: scene.code ? "code" : "layers",
  })),
  images: (project.assets ?? [])
    .filter((a) => a.mime === "image/png")
    .map((a) => ({ id: a.id, name: a.name, width: a.width, height: a.height })),
  studioUrl: `/?project=${project.id}`,
});
const text = (value: unknown): ToolContent => ({
  type: "text",
  text: typeof value === "string" ? value : JSON.stringify(value, null, 2),
});

// One preview at a time per process (each runs a headless browser).
let previewQueue: Promise<unknown> = Promise.resolve();
async function preview(
  ctx: McpContext,
  code: MotionCode,
  format: keyof typeof motionStages,
  seconds: number,
  project?: Project,
): Promise<ToolResult> {
  const limit = limitsPolicy().previews;
  const taken = takeRequestLimit(
    ctx.access.workspace.id,
    "previews",
    limit.count,
    limit.windowMs,
  );
  if (!taken.allowed) throw new RequestRateError(taken.retryAfter, "previews");
  const images = (project?.assets ?? []).filter(
    (a) =>
      a.mime === "image/png" &&
      [code.html, code.css, code.js].some((part) => part.includes(a.id)),
  );
  const assets = Object.fromEntries(
    await Promise.all(
      images.map(
        async (a) =>
          [
            a.id,
            {
              bytes: await readFile(path.join(assetDir, a.id)),
              type: "image/png",
            },
          ] as const,
      ),
    ),
  );
  const scene = { ...code, assets: images.map((a) => a.id).slice(0, 12) };
  const times = reviewTimes(seconds);
  const run = previewQueue.then(() =>
    previewMotionScene({
      code: scene,
      format,
      durationSeconds: seconds,
      times,
      probeTimes: motionProbeTimes(seconds),
      coverageAt: coverageTimes(seconds),
      auditAt: times.slice(1),
      width: format === "portrait" ? 360 : 640,
      assets,
      timeoutMs: 120000,
    }),
  );
  previewQueue = run.catch(() => undefined);
  const result = await run;
  const problems = sceneProblems(result, seconds, {
    threeD: !!code.libraries?.includes("three"),
  });
  const content: ToolContent[] = [
    text(
      problems.length
        ? `Automatic checks found ${problems.length} problem(s):\n${problems.map((p) => `- ${p}`).join("\n")}`
        : "Automatic checks passed: no errors, frozen stretches, underfilled frames or layout problems. Judge the stills for composition, hierarchy and meaning.",
    ),
  ];
  if (result.frames.length) {
    const sheet = await sharp(
      await contactSheet(result.frames, format === "portrait" ? 6 : 3),
    )
      .jpeg({ quality: 80 })
      .toBuffer();
    content.push({
      type: "image",
      data: sheet.toString("base64"),
      mimeType: "image/jpeg",
    });
    content.push(
      text(
        `Stills at ${result.frames.map((f) => `${f.time.toFixed(1)}s`).join(", ")} (left to right, top to bottom).`,
      ),
    );
  }
  return {
    content,
    structuredContent: {
      passed: problems.length === 0,
      problems,
      stillTimes: result.frames.map((f) => f.time),
    },
  };
}

const formatSchema = z.enum(["landscape", "portrait", "square"]);
const codeFields = {
  html: z.string().max(200000).describe("Scene HTML, placed inside #stage."),
  css: z.string().max(200000).describe("Scene CSS."),
  js: z
    .string()
    .min(1)
    .max(200000)
    .describe("Scene JavaScript: one master GSAP timeline from time 0."),
  libraries: z
    .array(z.enum(["d3", "three"]))
    .max(2)
    .optional()
    .describe('Optional libraries: "three" for R.three, "d3".'),
};
const sceneSeconds = z
  .number()
  .min(1)
  .max(MAX_CODE_SCENE_FRAMES / 30);

type ToolDefinition<S extends z.ZodObject> = {
  name: string;
  title: string;
  description: string;
  input: S;
  readOnly?: boolean;
  destructive?: boolean;
  run: (args: z.infer<S>, ctx: McpContext) => Promise<ToolResult>;
};
const tool = <S extends z.ZodObject>(definition: ToolDefinition<S>) =>
  definition as unknown as ToolDefinition<z.ZodObject>;

export const tools = [
  tool({
    name: "get_motion_guide",
    title: "Read the motion guide",
    description:
      "Read this first. The runtime contract, the motion kit (R: nodes, labelled arrows, callouts, steps, UI mockups with a cursor, charts, stats, isometric stacks, shots with transitions, kinetic type, 3D with a globe) and the design standards every scene is checked against.",
    input: z.object({
      references: z
        .boolean()
        .optional()
        .describe("Include five complete reference scenes (much longer)."),
    }),
    readOnly: true,
    run: async ({ references }) => ({
      content: [text(motionGuide({ references: !!references }))],
    }),
  }),
  tool({
    name: "list_projects",
    title: "List projects",
    description:
      "The studio's projects, newest first, optionally searched by name.",
    input: z.object({
      query: z.string().max(100).optional(),
      limit: z.number().int().min(1).max(50).optional(),
    }),
    readOnly: true,
    run: async ({ query, limit }, ctx) => {
      const params = new URLSearchParams({
        query: query ?? "",
        offset: "0",
        limit: String(limit ?? 20),
        view: "summary",
      });
      const page = await call(
        ctx,
        projectsRoute.GET as Route,
        "GET",
        `/api/projects?${params}`,
      );
      return { content: [text(page)], structuredContent: page };
    },
  }),
  tool({
    name: "create_project",
    title: "Create a project",
    description:
      "Creates an empty film with the given format and length (split into scenes of up to 20 s, which you can then write, add or resize).",
    input: z.object({
      title: z.string().min(3).max(1200).describe("What the film is about."),
      format: formatSchema,
      seconds: z.number().int().min(5).max(300),
    }),
    run: async ({ title, format, seconds }, ctx) => {
      const project = (await call(
        ctx,
        projectsRoute.POST as Route,
        "POST",
        "/api/projects",
        { body: { prompt: title, duration: seconds, format, blank: true } },
      )) as Project;
      const result = summary(project);
      return { content: [text(result)], structuredContent: result };
    },
  }),
  tool({
    name: "get_project",
    title: "Get a project",
    description:
      "A project's scenes (index, id, title, length, code or layers), its uploaded images (IDs usable in scenes) and its current revision.",
    input: z.object({ project_id: z.string().uuid() }),
    readOnly: true,
    run: async ({ project_id }, ctx) => {
      const result = summary(await getProject(ctx, project_id));
      return { content: [text(result)], structuredContent: result };
    },
  }),
  tool({
    name: "get_scene",
    title: "Get a scene's code",
    description: "The HTML, CSS, JavaScript and libraries of one scene.",
    input: z.object({
      project_id: z.string().uuid(),
      scene_index: z.number().int().min(0),
    }),
    readOnly: true,
    run: async ({ project_id, scene_index }, ctx) => {
      const { scene } = sceneAt(await getProject(ctx, project_id), scene_index);
      const result = {
        index: scene_index,
        title: scene.title,
        seconds: scene.durationFrames / 30,
        code: scene.code ?? null,
        note: scene.code
          ? undefined
          : "This scene is made of editor layers, not code. write_scene replaces it with a code scene.",
      };
      return { content: [text(result)], structuredContent: result };
    },
  }),
  tool({
    name: "write_scene",
    title: "Write a scene",
    description:
      "Saves a code scene (HTML, CSS, JavaScript, libraries) into the project at scene_index, replacing what was there, then previews it: returns stills and the automatic checks. Revise and write again until the checks pass.",
    input: z.object({
      project_id: z.string().uuid(),
      scene_index: z.number().int().min(0),
      title: z.string().min(1).max(100).optional(),
      seconds: sceneSeconds.optional().describe("New length of the scene."),
      ...codeFields,
      preview: z
        .boolean()
        .optional()
        .describe("Preview after saving (default true)."),
    }),
    run: async (args, ctx) => {
      const project = await getProject(ctx, args.project_id);
      const { timeline, scene } = sceneAt(project, args.scene_index);
      if (
        args.seconds !== undefined &&
        Math.round(args.seconds * 30) !== scene.durationFrames
      )
        assertNoTimedMedia(timeline);
      const used = (project.assets ?? [])
        .filter(
          (a) =>
            a.mime === "image/png" &&
            [args.html, args.css, args.js].some((part) => part.includes(a.id)),
        )
        .map((a) => a.id)
        .slice(0, 12);
      const code = motionCodeSchema.parse({
        html: args.html,
        css: args.css,
        js: args.js,
        ...(args.libraries?.length ? { libraries: args.libraries } : {}),
        ...(used.length ? { assets: used } : {}),
      });
      const next: Scene = {
        ...scene,
        ...(args.title ? { title: args.title } : {}),
        ...(args.seconds !== undefined
          ? { durationFrames: Math.round(args.seconds * 30) }
          : {}),
        layers: [],
        code,
      };
      const saved = await saveTimeline(ctx, project, {
        ...timeline,
        scenes: timeline.scenes.map((s, i) =>
          i === args.scene_index ? next : s,
        ),
      });
      const done = text(
        `Saved scene ${args.scene_index} ("${next.title}", ${next.durationFrames / 30}s). Revision ${revisionId(saved)}.`,
      );
      if (args.preview === false)
        return { content: [done], structuredContent: summary(saved) };
      const checked = await preview(
        ctx,
        code,
        timeline.format,
        next.durationFrames / 30,
        saved,
      );
      return { ...checked, content: [done, ...checked.content] };
    },
  }),
  tool({
    name: "preview_scene",
    title: "Preview a scene",
    description:
      "Renders stills of a saved scene (by index) or of unsaved code (html, css, js with format and seconds) and runs the automatic checks: JavaScript errors, empty or frozen stretches, underfilled frames, clipped, overlapping or too-small text.",
    input: z.object({
      project_id: z.string().uuid().optional(),
      scene_index: z.number().int().min(0).optional(),
      html: codeFields.html.optional(),
      css: codeFields.css.optional(),
      js: codeFields.js.optional(),
      libraries: codeFields.libraries,
      format: formatSchema.optional(),
      seconds: sceneSeconds.optional(),
    }),
    readOnly: true,
    run: async (args, ctx) => {
      const project = args.project_id
        ? await getProject(ctx, args.project_id)
        : undefined;
      if (args.js !== undefined) {
        const code = motionCodeSchema.parse({
          html: args.html ?? "",
          css: args.css ?? "",
          js: args.js,
          ...(args.libraries?.length ? { libraries: args.libraries } : {}),
        });
        return preview(
          ctx,
          code,
          args.format ?? project?.timeline?.format ?? "landscape",
          args.seconds ?? 10,
          project,
        );
      }
      if (!project || args.scene_index === undefined)
        throw new ToolError(
          "Give project_id and scene_index for a saved scene, or js (with html, css, format and seconds) for unsaved code.",
        );
      const { timeline, scene } = sceneAt(project, args.scene_index);
      if (!scene.code)
        throw new ToolError(
          "That scene is made of editor layers; only code scenes can be previewed here.",
        );
      return preview(
        ctx,
        scene.code,
        timeline.format,
        scene.durationFrames / 30,
        project,
      );
    },
  }),
  tool({
    name: "add_scene",
    title: "Add a scene",
    description:
      "Appends an empty scene of the given length at the end of the film (write it with write_scene).",
    input: z.object({
      project_id: z.string().uuid(),
      seconds: sceneSeconds,
      title: z.string().min(1).max(100).optional(),
    }),
    run: async ({ project_id, seconds, title }, ctx) => {
      const project = await getProject(ctx, project_id);
      if (!project.timeline)
        throw new ToolError("The project has no timeline.");
      const last = project.timeline.scenes.at(-1);
      const scene: Scene = {
        id: crypto.randomUUID(),
        title: title ?? `Scene ${project.timeline.scenes.length + 1}`,
        intent: "Written by an assistant",
        durationFrames: Math.round(seconds * 30),
        background: last?.background ?? "#0b1020",
        accent: last?.accent ?? "#38bdf8",
        strategy: "diagram",
        transition: "cut",
        layers: [],
        code: {
          html: "",
          css: "",
          js: "gsap.timeline();",
        },
      };
      const saved = await saveTimeline(ctx, project, {
        ...project.timeline,
        scenes: [...project.timeline.scenes, scene],
      });
      const result = summary(saved);
      return { content: [text(result)], structuredContent: result };
    },
  }),
  tool({
    name: "remove_scene",
    title: "Remove a scene",
    description:
      "Removes a scene; later scenes move earlier. The studio keeps earlier versions in its history.",
    input: z.object({
      project_id: z.string().uuid(),
      scene_index: z.number().int().min(0),
    }),
    destructive: true,
    run: async ({ project_id, scene_index }, ctx) => {
      const project = await getProject(ctx, project_id);
      const { timeline } = sceneAt(project, scene_index);
      if (timeline.scenes.length === 1)
        throw new ToolError("A film needs at least one scene.");
      assertNoTimedMedia(timeline);
      const saved = await saveTimeline(ctx, project, {
        ...timeline,
        scenes: timeline.scenes.filter((_, i) => i !== scene_index),
      });
      const result = summary(saved);
      return { content: [text(result)], structuredContent: result };
    },
  }),
  tool({
    name: "direct_film",
    title: "Ask the built-in director",
    description:
      "Starts the studio's own AI director (with the owner's AI key) to animate the whole film from an instruction, or to revise one scene. Check progress with director_status.",
    input: z.object({
      project_id: z.string().uuid(),
      instruction: z.string().min(3).max(1200),
      scene_id: z.string().max(80).optional(),
      preset: z.enum(directorPresetIds).optional(),
      quality: z.enum(["standard", "high"]).optional(),
    }),
    run: async (args, ctx) => {
      const data = await call(
        ctx,
        directRoute.POST as Route,
        "POST",
        `/api/projects/${args.project_id}/direct`,
        {
          params: { id: args.project_id },
          body: {
            instruction: args.instruction,
            ...(args.scene_id ? { sceneId: args.scene_id } : {}),
            ...(args.preset ? { preset: args.preset } : {}),
            ...(args.quality ? { quality: args.quality } : {}),
          },
        },
      );
      return { content: [text(data)], structuredContent: data };
    },
  }),
  tool({
    name: "director_status",
    title: "Director status",
    description: "Progress of the built-in director's latest run on a project.",
    input: z.object({ project_id: z.string().uuid() }),
    readOnly: true,
    run: async ({ project_id }, ctx) => {
      const data = await call(
        ctx,
        directRoute.GET as Route,
        "GET",
        `/api/projects/${project_id}/direct`,
        { params: { id: project_id } },
      );
      return { content: [text(data)], structuredContent: data };
    },
  }),
  tool({
    name: "export_video",
    title: "Export the video",
    description:
      "Starts rendering the project's current version to an MP4. Rendering takes minutes; check export_status. The owner downloads the file from the studio.",
    input: z.object({ project_id: z.string().uuid() }),
    run: async ({ project_id }, ctx) => {
      const project = await getProject(ctx, project_id);
      const job = await call(
        ctx,
        renderRoute.POST as Route,
        "POST",
        `/api/projects/${project_id}/render`,
        {
          params: { id: project_id },
          body: { baseRevisionId: revisionId(project) },
        },
      );
      const result = { jobId: job.id, status: job.status, stage: job.stage };
      return { content: [text(result)], structuredContent: result };
    },
  }),
  tool({
    name: "export_status",
    title: "Export status",
    description: "Status and progress of an export started with export_video.",
    input: z.object({ job_id: z.string().uuid() }),
    readOnly: true,
    run: async ({ job_id }, ctx) => {
      const job = await call(
        ctx,
        jobRoute.GET as Route,
        "GET",
        `/api/jobs/${job_id}`,
        { params: { id: job_id } },
      );
      const result = {
        jobId: job.id,
        status: job.status,
        stage: job.stage,
        progress: job.progress,
        queueAhead: job.queueAhead,
        error: job.error ?? undefined,
        note:
          job.status === "completed"
            ? "The MP4 is ready: download it from the project's Export history in the studio."
            : undefined,
      };
      return { content: [text(result)], structuredContent: result };
    },
  }),
];
