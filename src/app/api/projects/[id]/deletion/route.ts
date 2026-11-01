import { secureRoute, type Access } from "@/lib/access";
import { requestOwnedProjectDeletion, ownedProjectDeletion } from "@/lib/db";
import { body, failure } from "@/lib/http";
import { ProjectDeletionConflict } from "@/lib/project-deletion-policy";
import { z, ZodError } from "zod";
type Context = { params: Promise<{ id: string }> };
const headers = {
  "Cache-Control": "private, no-store",
  "X-Content-Type-Options": "nosniff",
};
function unavailable(error: unknown) {
  if (error instanceof ZodError || error instanceof ProjectDeletionConflict) {
    const response = failure(error);
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  }
  return Response.json(
    { error: "Project cleanup is temporarily unavailable. Try again." },
    { status: 503, headers },
  );
}
async function GETHandler(
  _request: Request,
  { params }: Context,
  access: Access,
) {
  try {
    const id = z.uuid().parse((await params).id);
    const result = ownedProjectDeletion(id, access.workspace.id);
    return result
      ? Response.json(result, { headers })
      : Response.json(
          { error: "Resource not found." },
          { status: 404, headers },
        );
  } catch (error) {
    return unavailable(error);
  }
}
async function POSTHandler(
  request: Request,
  { params }: Context,
  access: Access,
) {
  try {
    const id = z.uuid().parse((await params).id);
    let payload: unknown;
    try {
      payload = await body(request);
    } catch (error) {
      return Response.json(
        { error: "Send a JSON body with confirmation set to DELETE." },
        {
          status:
            error instanceof Error && error.message === "Request too large."
              ? 413
              : 400,
          headers,
        },
      );
    }
    z.object({ confirmation: z.literal("DELETE") }).parse(payload);
    const result = requestOwnedProjectDeletion(id, access.workspace.id);
    return result
      ? Response.json(result, {
          status: result.state === "completed" ? 200 : 202,
          headers,
        })
      : Response.json(
          { error: "Resource not found." },
          { status: 404, headers },
        );
  } catch (error) {
    return unavailable(error);
  }
}
export const GET = secureRoute(GETHandler, "user");
export const POST = secureRoute(POSTHandler, "user");
