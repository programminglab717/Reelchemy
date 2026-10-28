import { secureRoute } from "@/lib/access";
import { z } from "zod";
import { getProject, reviseProject } from "@/lib/db";
import { timelineSchema } from "@/lib/schema";
import { body, failure, localMutation } from "@/lib/http";
async function POSTHandler(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    localMutation(req);
    const { revisionId } = z
      .object({ revisionId: z.string().max(80) })
      .parse(await body(req));
    const p = getProject((await params).id);
    if (!p)
      return Response.json({ error: "Project not found" }, { status: 404 });
    const r = p.revisions.find((r) => r.id === revisionId);
    if (!r) throw new Error("Revision not found.");
    return Response.json(
      reviseProject(p, timelineSchema.parse(r.timeline), `Restored ${r.id}`),
    );
  } catch (e) {
    return failure(e);
  }
}

export const POST = secureRoute(POSTHandler, "project");
