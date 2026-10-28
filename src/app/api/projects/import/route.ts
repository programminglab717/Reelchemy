import { secureRoute, type Access } from "@/lib/access";
import { saveProject } from "@/lib/db";
import { importArchive } from "@/lib/archive";
import { localMutation, readLimitedBody, failure } from "@/lib/http";
async function POSTHandler(req: Request, _ctx: unknown, access: Access) {
  try {
    localMutation(req);
    const p = await importArchive(await readLimitedBody(req, 50 * 1024 * 1024));
    return Response.json(saveProject(p, access.workspace.id), { status: 201 });
  } catch (e) {
    return failure(e);
  }
}

export const POST = secureRoute(POSTHandler, "user");
