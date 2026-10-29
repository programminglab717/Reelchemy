import { RevisionConflict } from "@/lib/editor";
import { secureRoute } from "@/lib/access";
import { getProject, reviseProject } from "@/lib/db";
import { generatePlan, reviseScene } from "@/lib/provider";
import { failure, body, localMutation } from "@/lib/http";
import { z } from "zod";
async function POSTHandler(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
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
    const revisionCount = p.revisions.length;
    if (sceneId && (!revision || !p.timeline))
      throw new Error(
        "Scene revisions require an existing timeline and an instruction.",
      );
    const { timeline, provider } = sceneId
      ? {
          timeline: await reviseScene(p.timeline!, sceneId, revision!),
          provider: process.env.AI_PROVIDER || "mock",
        }
      : await generatePlan(
          revision ? { ...p.brief, prompt: revision } : p.brief,
          revision && p.timeline
            ? { current: p.timeline, instruction: revision }
            : undefined,
        );
    if (getProject(p.id)?.revisions.length !== revisionCount)
      throw new RevisionConflict();
    p.messages.push({
      role: "assistant",
      content: `${provider === "mock" ? "Demo director" : "AI director"} prepared ${timeline.scenes.length} scenes. Review the storyboard, edit any scene, then approve your export.`,
    });
    return Response.json(
      reviseProject(
        p,
        timeline,
        sceneId ? `${provider}: scene ${sceneId}` : provider,
      ),
    );
  } catch (e) {
    return failure(e);
  }
}

export const POST = secureRoute(POSTHandler, "project", { rate: "planning" });
