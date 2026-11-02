import { projectResponse, privateProjectHeaders } from "@/lib/project-http";
import { secureRoute, type Access } from "@/lib/access";
import { getProject, reviseOwnedProject, providerUsage } from "@/lib/db";
import { providerConfiguration } from "@/lib/provider-config";
import { providerBudgetPolicy } from "@/lib/provider-budget-policy";
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
    const configuration = providerConfiguration();
    const accounting =
      configuration.provider === "mock"
        ? undefined
        : providerUsage.accounting(access.workspace.id, providerBudgetPolicy());
    const { timeline, provider } = sceneId
      ? {
          timeline: await reviseScene(
            p.timeline!,
            sceneId,
            revision!,
            p.assets,
            accounting,
          ),
          provider: process.env.AI_PROVIDER || "mock",
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
