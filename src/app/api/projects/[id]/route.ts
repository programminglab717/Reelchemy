import { secureRoute } from "@/lib/access";
import { validateProjectAssets } from "@/lib/assets";
import { getProject, reviseProject } from "@/lib/db";
import { timelineSchema } from "@/lib/schema";
import { failure, body, localMutation } from "@/lib/http";
import { revisionId, RevisionConflict } from "@/lib/editor";
import { z } from "zod";
type Context = { params: Promise<{ id: string }> };
async function GETHandler(_: Request, { params }: Context) {
  const p = getProject((await params).id);
  return p
    ? Response.json(p)
    : Response.json({ error: "Project not found" }, { status: 404 });
}
async function PATCHHandler(req: Request, { params }: Context) {
  try {
    localMutation(req);
    const p = getProject((await params).id);
    if (!p)
      return Response.json({ error: "Project not found" }, { status: 404 });
    const { timeline, baseRevisionId } = z
      .object({
        timeline: timelineSchema,
        baseRevisionId: z.string().min(1).max(80).nullable(),
      })
      .parse(await body(req));
    // Read after the asynchronous body, then compare and commit synchronously.
    const latest = getProject(p.id)!;
    if (revisionId(latest) !== baseRevisionId) throw new RevisionConflict();
    validateProjectAssets(latest, timeline);
    return Response.json(reviseProject(latest, timeline, "Scene editor"));
  } catch (e) {
    return failure(e);
  }
}

export const GET = secureRoute(GETHandler, "project");
export const PATCH = secureRoute(PATCHHandler, "project");
