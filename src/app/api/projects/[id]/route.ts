import { MAX_EDITABLE_TIMELINE_BYTES } from "@/lib/timeline-limits";
import { secureRoute, type Access } from "@/lib/access";
import { getProject, reviseOwnedProject } from "@/lib/db";
import { timelineSchema } from "@/lib/schema";
import { failure, body, localMutation } from "@/lib/http";
import { revisionId, RevisionConflict } from "@/lib/editor";
import { z } from "zod";
import {
  wantsEditorProject,
  editorProjectResponse,
  projectResponse,
  privateProjectHeaders,
} from "@/lib/project-http";
type Context = { params: Promise<{ id: string }> };
async function GETHandler(
  request: Request,
  { params }: Context,
  access: Access,
) {
  const id = (await params).id;
  if (wantsEditorProject(request))
    return editorProjectResponse(id, access.workspace.id);
  const p = getProject(id);
  return p
    ? projectResponse(request, p, access.workspace.id)
    : Response.json({ error: "Project not found" }, { status: 404 });
}
async function PATCHHandler(req: Request, { params }: Context, access: Access) {
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
      .parse(await body(req, MAX_EDITABLE_TIMELINE_BYTES + 1024));
    // Read after the asynchronous body, then compare and commit synchronously.
    const latest = getProject(p.id)!;
    if (revisionId(latest) !== baseRevisionId) throw new RevisionConflict();
    const saved = reviseOwnedProject(
      latest,
      timeline,
      "Scene editor",
      access.workspace.id,
    );
    return saved
      ? projectResponse(req, saved, access.workspace.id)
      : Response.json({ error: "Project not found" }, { status: 404 });
  } catch (e) {
    return failure(e);
  }
}

const getRoute = secureRoute(GETHandler, "project");
const patchRoute = secureRoute(PATCHHandler, "project");
async function privateResponse(response: Promise<Response>) {
  const result = await response;
  for (const [name, value] of Object.entries(privateProjectHeaders))
    result.headers.set(name, value);
  return result;
}
export const GET = (request: Request, context: Context) =>
  privateResponse(getRoute(request, context));
export const PATCH = (request: Request, context: Context) =>
  privateResponse(patchRoute(request, context));
