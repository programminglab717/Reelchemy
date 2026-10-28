import { secureRoute } from "@/lib/access";
import { validateProjectAssets } from "@/lib/assets";
import { getProject, reviseProject } from "@/lib/db";
import { timelineSchema } from "@/lib/schema";
import { failure, body, localMutation } from "@/lib/http";
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
    const timeline = timelineSchema.parse(await body(req));
    validateProjectAssets(p, timeline);
    return Response.json(reviseProject(p, timeline, "Scene editor"));
  } catch (e) {
    return failure(e);
  }
}

export const GET = secureRoute(GETHandler, "project");
export const PATCH = secureRoute(PATCHHandler, "project");
