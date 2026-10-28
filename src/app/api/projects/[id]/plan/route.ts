import { getProject, reviseProject } from "@/lib/db";
import { generatePlan } from "@/lib/provider";
import { failure, body, localMutation } from "@/lib/http";
import { z } from "zod";
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    localMutation(req);
    const p = getProject((await params).id);
    if (!p)
      return Response.json({ error: "Project not found" }, { status: 404 });
    const { revision } = z
      .object({ revision: z.string().trim().max(1200).optional() })
      .parse(await body(req));
    if (revision) {
      p.brief.prompt = revision;
      p.messages.push({ role: "user", content: revision });
    }
    const { timeline, provider } = await generatePlan(p.brief);
    p.messages.push({
      role: "assistant",
      content: `${provider === "mock" ? "Demo director" : "AI director"} prepared ${timeline.scenes.length} scenes. Review the storyboard, edit any scene, then approve your export.`,
    });
    return Response.json(reviseProject(p, timeline, provider));
  } catch (e) {
    return failure(e);
  }
}
