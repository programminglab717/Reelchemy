import { secureRoute, type Access } from "@/lib/access";
import {
  directorJobs,
  getProject,
  ownedPlanningStorageAvailable,
  studioAiCredentials,
  studioAiEntitlements,
} from "@/lib/db";
import { authSigningSecret } from "@/lib/auth";
import { resolveStudioAi } from "@/lib/studio-ai-access";
import { body, failure } from "@/lib/http";
import { privateProjectHeaders } from "@/lib/project-http";
import { DirectorBusy, type DirectorRequest } from "@/director/jobs";
import { directorPresetIds } from "@/director/presets";
import {
  cancelDirectorJob,
  recoverDirector,
  startDirectorJob,
} from "@/director/runner";
import { z } from "zod";

type Context = { params: Promise<{ id: string }> };
const json = (value: unknown, status = 200) =>
  Response.json(value, { status, headers: privateProjectHeaders });

// Starts the AI director on this project: the whole film from its brief, a
// revision of the whole film, or one code scene. Runs in the background.
async function POSTHandler(req: Request, { params }: Context, access: Access) {
  recoverDirector();
  try {
    const project = getProject((await params).id);
    if (!project) return json({ error: "Project not found" }, 404);
    const input = z
      .object({
        instruction: z.string().trim().min(3).max(1200).optional(),
        sceneId: z.string().max(80).optional(),
        referenceAssetId: z
          .string()
          .regex(/^[a-f0-9-]{36}$/)
          .optional(),
        preset: z.enum(directorPresetIds).optional(),
        quality: z.enum(["standard", "high"]).optional(),
      })
      .strict()
      .parse(await body(req));
    if (
      input.referenceAssetId &&
      !project.assets?.some(
        (a) =>
          a.id === input.referenceAssetId &&
          (a.mime === "video/mp4" || a.mime === "image/png"),
      )
    )
      throw new Error(
        "A style reference must be a video or image uploaded to this project.",
      );
    const reference = {
      ...(input.referenceAssetId
        ? { referenceAssetId: input.referenceAssetId }
        : {}),
      ...(input.quality ? { quality: input.quality } : {}),
    };
    const style = input.preset ? { preset: input.preset } : {};
    if (input.sceneId && !input.instruction)
      throw new Error("Describe how the scene should change.");
    if (!ownedPlanningStorageAvailable(project.id, access.workspace.id, 2))
      return json({ error: "Project not found" }, 404);
    const studioAi = resolveStudioAi(
      access.workspace.id,
      { credentials: studioAiCredentials, entitlements: studioAiEntitlements },
      authSigningSecret,
    );
    if (studioAi.access === "demo")
      return json(
        {
          error:
            "Add your AI provider key in Account settings to have the director animate your film.",
          code: "DIRECTOR_NEEDS_KEY",
        },
        409,
      );
    const request: DirectorRequest =
      input.sceneId && input.instruction
        ? {
            kind: "scene-revision",
            sceneId: input.sceneId,
            instruction: input.instruction,
            ...reference,
          }
        : input.instruction && project.timeline
          ? {
              kind: "film-revision",
              instruction: input.instruction,
              ...reference,
              ...style,
            }
          : { kind: "film", ...reference, ...style };
    const job = directorJobs.create(access.workspace.id, project.id, request);
    startDirectorJob(job, access.workspace.id);
    return json({ job }, 202);
  } catch (error) {
    if (error instanceof DirectorBusy)
      return json({ error: error.message, code: "DIRECTOR_BUSY" }, 409);
    return failure(error);
  }
}
async function GETHandler(_req: Request, { params }: Context, access: Access) {
  recoverDirector();
  return json({
    job: directorJobs.latest((await params).id, access.workspace.id) ?? null,
  });
}
async function DELETEHandler(
  _req: Request,
  { params }: Context,
  access: Access,
) {
  const job = directorJobs.latest((await params).id, access.workspace.id);
  if (job && directorJobs.cancel(job.id, access.workspace.id))
    cancelDirectorJob(job.id);
  return json({
    job: job ? directorJobs.get(job.id, access.workspace.id) : null,
  });
}
export const POST = secureRoute(POSTHandler, "project", { rate: "planning" });
export const GET = secureRoute(GETHandler, "project");
export const DELETE = secureRoute(DELETEHandler, "project");
