import {
  directorJobs,
  getProject,
  providerUsage,
  reviseOwnedProject,
  studioAiCredentials,
  studioAiEntitlements,
} from "../lib/db";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { authSigningSecret } from "../lib/auth";
import { assetDir } from "../lib/assets";
import { resolveStudioAi } from "../lib/studio-ai-access";
import { ProviderError } from "../lib/provider-error";
import { RevisionConflict } from "../lib/editor";
import {
  timelineSchema,
  totalFrames,
  type CreativeBrief,
  type Timeline,
} from "../lib/schema";
import { previewMotionScene } from "../motion/preflight";
import { directFilm, directScene, type SceneReport } from "./director";
import { filmPlanSchema, type FilmPlan } from "./prompts";
import { providerLlm, type Llm, type LlmConfiguration } from "./llm";
import type { DirectorJob } from "./jobs";

// Runs director jobs inside the studio process. State lives in the database;
// a run interrupted by a restart is marked failed when this module loads.
const running = new Map<string, AbortController>();
let interrupted = false;
export function recoverDirector() {
  if (interrupted) return;
  interrupted = true;
  directorJobs.interruptAll();
}

// Scene previews start a browser each; run one at a time per process.
let previews: Promise<unknown> = Promise.resolve();
const serializedPreview: typeof previewMotionScene = (input) => {
  const next = previews.then(() => previewMotionScene(input));
  previews = next.catch(() => {});
  return next;
};
// Models that accept images on these providers' APIs.
export function supportsImages(config: LlmConfiguration) {
  if (config.provider === "anthropic") return true;
  const host = new URL(config.endpoint).hostname;
  return (
    host === "api.openai.com" || host === "generativelanguage.googleapis.com"
  );
}
const transient = new Set([
  "AI_BUSY",
  "AI_PROVIDER_RATE_LIMITED",
  "AI_UNAVAILABLE",
]);
// Retries busy, rate-limited and transient provider failures with backoff.
export function patientLlm(
  llm: Llm,
  wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms)),
): Llm {
  return async (request) => {
    for (let attempt = 0; ; attempt++) {
      try {
        return await llm(request);
      } catch (error) {
        if (
          attempt >= 4 ||
          request.signal?.aborted ||
          !(error instanceof ProviderError) ||
          !transient.has(error.code)
        )
          throw error;
        await wait(
          Math.max((error.retryAfter ?? 0) * 1000, 5000 * 2 ** attempt),
        );
      }
    }
  };
}
// A storyboard reconstructed from an existing film (made before the director
// kept plans), so its scenes can be revised in the same style.
function planFromTimeline(timeline: Timeline, prompt: string): FilmPlan {
  const first = timeline.scenes[0];
  return filmPlanSchema.parse({
    title: prompt.slice(0, 100) || "Film",
    logline: prompt.slice(0, 400),
    style: {
      background: first.background,
      surface: first.background,
      text: "#f1f5f9",
      muted: "#94a3b8",
      accents: [...new Set(timeline.scenes.map((s) => s.accent))].slice(0, 6),
      motion: "Smooth, confident easing; consistent with the existing scenes.",
      motifs: "Keep the look of the existing scenes.",
    },
    scenes: timeline.scenes.map((s) => ({
      title: s.title,
      seconds: Math.max(3, Math.min(60, s.durationFrames / 30)),
      goal: s.intent || s.title,
      visual: s.intent || s.title,
    })),
  });
}
function summarize(scenes: SceneReport[], verb: string) {
  const fixed = scenes.filter((s) => s.attempts > 1).length;
  const open = scenes.filter((s) => s.remaining.length).length;
  const fallback = scenes.filter((s) => s.fallback).length;
  const fitted = scenes.filter((s) => s.fitted).length;
  return [
    `AI director ${verb} ${scenes.length} ${scenes.length === 1 ? "scene" : "scenes"}: ${scenes.map((s) => s.title).join(" · ")}.`,
    fixed ? `${fixed} improved after reviewing test renders.` : "",
    open
      ? `${open} still ${open === 1 ? "has" : "have"} minor issues the checks noticed; preview before exporting.`
      : "",
    fitted
      ? `${fitted} ${fitted === 1 ? "was" : "were"} scaled slightly to fit the frame.`
      : "",
    fallback
      ? `${fallback} could not be animated and ${fallback === 1 ? "is" : "are"} a simple title card; revise ${fallback === 1 ? "it" : "them"} with an instruction.`
      : "",
  ]
    .filter(Boolean)
    .join(" ");
}

export function startDirectorJob(job: DirectorJob, workspaceId: string) {
  const controller = new AbortController();
  running.set(job.id, controller);
  void runJob(job, workspaceId, controller.signal).finally(() =>
    running.delete(job.id),
  );
}
export function cancelDirectorJob(jobId: string) {
  running.get(jobId)?.abort();
}

async function runJob(
  job: DirectorJob,
  workspaceId: string,
  signal: AbortSignal,
) {
  let last = 0;
  const progress = (stage: string, fraction: number) => {
    // A cancellation from another request stops the work too.
    if (!directorJobs.isActive(job.id)) {
      running.get(job.id)?.abort();
      return;
    }
    const now = Date.now();
    if (now - last < 500 && fraction < 1) return;
    last = now;
    directorJobs.progress(job.id, stage, fraction);
  };
  try {
    progress("Starting", 0.01);
    const project = getProject(job.projectId);
    if (!project) throw new Error("The project is no longer available.");
    const studioAi = resolveStudioAi(
      workspaceId,
      { credentials: studioAiCredentials, entitlements: studioAiEntitlements },
      authSigningSecret,
    );
    if (studioAi.access === "demo")
      throw new Error(
        "Add your AI provider key in Account settings to have the director animate your film.",
      );
    const llm = patientLlm(
      providerLlm(
        studioAi.configuration,
        providerUsage.accounting(workspaceId, studioAi.policy, studioAi.access),
      ),
    );
    // Up to eight uploaded images (logos, products, screenshots) for scenes.
    const images = (
      await Promise.all(
        (project.assets || [])
          .filter(
            (a) => a.mime === "image/png" && (a.bytes ?? 0) <= 12 * 1024 ** 2,
          )
          .slice(-8)
          .map(async (a) => {
            try {
              const bytes = await readFile(path.join(assetDir, a.id));
              return {
                id: a.id,
                name: a.name,
                width: a.width,
                height: a.height,
                bytes,
              };
            } catch {
              return null;
            }
          }),
      )
    ).filter((image) => image !== null);
    const common = {
      llm,
      images,
      vision: supportsImages(studioAi.configuration),
      signal,
      concurrency: studioAi.policy.studioConcurrency,
      preview: serializedPreview,
      progress,
    };
    const storedPlan = filmPlanSchema.safeParse(
      directorJobs.latestPlan(project.id, workspaceId),
    );
    let timeline: Timeline,
      plan: FilmPlan,
      summary: string,
      userMessage: string | undefined;
    const request = job.request;
    if (request.kind === "scene-revision") {
      const current = project.timeline;
      const index =
        current?.scenes.findIndex((s) => s.id === request.sceneId) ?? -1;
      if (!current || index < 0)
        throw new Error("That scene is no longer in the film.");
      if (!current.scenes[index].code)
        throw new Error(
          "Only animated code scenes can be revised by the director; edit this scene manually.",
        );
      plan =
        storedPlan.success &&
        storedPlan.data.scenes.length === current.scenes.length
          ? storedPlan.data
          : planFromTimeline(current, project.brief.prompt);
      // The film may have been edited since; keep the scene's real length.
      plan.scenes[index].seconds = current.scenes[index].durationFrames / 30;
      const result = await directScene({
        ...common,
        brief: {
          prompt: project.brief.prompt,
          duration: totalFrames(current) / 30,
          format: current.format,
        },
        plan,
        index,
        current: current.scenes[index].code!,
        instruction: request.instruction,
      });
      timeline = timelineSchema.parse({
        ...current,
        scenes: current.scenes.map((scene, i) =>
          i === index ? { ...scene, code: result.code } : scene,
        ),
      });
      summary = summarize([result.report], "revised");
      userMessage = request.instruction;
    } else {
      const brief: CreativeBrief =
        request.kind === "film-revision" && project.timeline
          ? {
              prompt: storedPlan.success
                ? project.brief.prompt
                : `${project.brief.prompt}\n\nRevision: ${request.instruction}`,
              duration: totalFrames(project.timeline) / 30,
              format: project.timeline.format,
            }
          : project.brief;
      const result = await directFilm({
        ...common,
        brief,
        ...(request.kind === "film-revision" && storedPlan.success
          ? { previous: storedPlan.data, instruction: request.instruction }
          : {}),
      });
      timeline = result.timeline;
      plan = result.plan;
      summary = summarize(
        result.scenes,
        request.kind === "film-revision" ? "rewrote the film as" : "animated",
      );
      if (request.kind === "film-revision") userMessage = request.instruction;
    }
    signal.throwIfAborted();
    // Save on top of whatever the maker did meanwhile.
    for (let attempt = 0; ; attempt++) {
      const latest = getProject(job.projectId);
      if (!latest) throw new Error("The project is no longer available.");
      if (userMessage)
        latest.messages.push({ role: "user", content: userMessage });
      latest.messages.push({ role: "assistant", content: summary });
      try {
        if (!reviseOwnedProject(latest, timeline, "AI director", workspaceId))
          throw new Error("The project is no longer available.");
        break;
      } catch (error) {
        if (!(error instanceof RevisionConflict) || attempt >= 2) throw error;
      }
    }
    directorJobs.complete(job.id, summary, plan);
  } catch (error) {
    if (!directorJobs.isActive(job.id)) return;
    directorJobs.fail(
      job.id,
      error instanceof ProviderError || error instanceof Error
        ? error.message
        : "The director could not finish this film.",
    );
    if (!(error instanceof ProviderError))
      console.error(
        JSON.stringify({
          event: "director.failed",
          job: job.id,
          error:
            error instanceof Error ? error.message.slice(0, 300) : "unknown",
        }),
      );
  }
}
