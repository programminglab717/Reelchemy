import { projectResponse, privateProjectHeaders } from "@/lib/project-http";
import { secureRoute, type Access } from "@/lib/access";
import {
  getProject,
  reviseOwnedProject,
  providerUsage,
  ownedPlanningStorageAvailable,
  studioAiCredentials,
  studioAiEntitlements,
} from "@/lib/db";
import { authSigningSecret } from "@/lib/auth";
import { resolveStudioAi } from "@/lib/studio-ai-access";
import { totalFrames } from "@/lib/schema";
import { generatePlan, reviseScene } from "@/lib/provider";
import { failure, body, localMutation } from "@/lib/http";
import { z } from "zod";
async function POSTHandler(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
  access: Access,
) {
  try {
    localMutation(req);
    const p = getProject((await params).id);
    if (!p)
      return Response.json({ error: "Project not found" }, { status: 404 });
    const { revision, sceneId } = z
      .object({
        revision: z.string().trim().min(3).max(1200).optional(),
        sceneId: z.string().max(80).optional(),
      })
      .parse(await body(req));
    if (revision) {
      p.messages.push({ role: "user", content: revision });
    }
    if (sceneId && (!revision || !p.timeline))
      throw new Error(
        "Scene revisions require an existing timeline and an instruction.",
      );
    if (
      !ownedPlanningStorageAvailable(
        p.id,
        access.workspace.id,
        revision ? 2 : 1,
      )
    )
      return Response.json({ error: "Project not found" }, { status: 404 });
    // The studio's own saved key, an entitled platform key, or the demo
    // director — resolved per request so a deleted key stops immediately.
    const studioAi = resolveStudioAi(
      access.workspace.id,
      { credentials: studioAiCredentials, entitlements: studioAiEntitlements },
      authSigningSecret,
    );
    const configuration =
      studioAi.access === "demo"
        ? ({ provider: "mock" } as const)
        : studioAi.configuration;
    const accounting =
      studioAi.access === "demo"
        ? undefined
        : providerUsage.accounting(
            access.workspace.id,
            studioAi.policy,
            studioAi.access,
          );
    const { timeline, provider } = sceneId
      ? {
          timeline: await reviseScene(
            p.timeline!,
            sceneId,
            revision!,
            p.assets,
            accounting,
            configuration,
          ),
          provider: configuration.provider,
        }
      : await generatePlan(
          revision && p.timeline
            ? {
                prompt: revision,
                duration: totalFrames(p.timeline) / p.timeline.fps,
                format: p.timeline.format,
              }
            : revision
              ? { ...p.brief, prompt: revision }
              : p.brief,
          revision && p.timeline
            ? { current: p.timeline, instruction: revision }
            : undefined,
          p.assets,
          accounting,
          configuration,
        );
    p.messages.push({
      role: "assistant",
      content: `${provider === "mock" ? "Demo director" : "AI director"} prepared ${timeline.scenes.length} scenes. Review the storyboard, edit any scene, then approve your export.`,
    });
    const saved = reviseOwnedProject(
      p,
      timeline,
      sceneId ? `${provider}: scene ${sceneId}` : provider,
      access.workspace.id,
    );
    return saved
      ? projectResponse(req, saved, access.workspace.id)
      : Response.json({ error: "Project not found" }, { status: 404 });
  } catch (e) {
    return failure(e);
  }
}

const planRoute = secureRoute(POSTHandler, "project", { rate: "planning" });
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const response = await planRoute(request, context);
  for (const [name, value] of Object.entries(privateProjectHeaders))
    response.headers.set(name, value);
  return response;
}
