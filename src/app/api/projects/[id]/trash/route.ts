import { secureRoute } from "@/lib/access";
import { setProjectTrashed, getProject } from "@/lib/db";
import { localMutation, failure } from "@/lib/http";
type Context = { params: Promise<{ id: string }> };
async function DELETEHandler(req: Request, { params }: Context) {
  try {
    localMutation(req);
    return Response.json(setProjectTrashed((await params).id, true));
  } catch (e) {
    return failure(e);
  }
}
async function POSTHandler(req: Request, { params }: Context) {
  try {
    localMutation(req);
    const { id } = await params;
    setProjectTrashed(id, false);
    return Response.json(getProject(id));
  } catch (e) {
    return failure(e);
  }
}
export const DELETE = secureRoute(DELETEHandler, "project", {
  includeTrashed: true,
});
export const POST = secureRoute(POSTHandler, "project", {
  includeTrashed: true,
});
