import { projectResponse } from "@/lib/project-http";
import { secureRoute, type Access } from "@/lib/access";
import { z, ZodError } from "zod";
import { restoreOwnedProject } from "@/lib/db";
import { RevisionConflict } from "@/lib/editor";
import { SavedVersionUnavailable } from "@/lib/project-history";
import { body, failure, localMutation, RequestBodyError } from "@/lib/http";
type Context = { params: Promise<{ id: string }> };
async function POSTHandler(req: Request, { params }: Context, access: Access) {
  try {
    localMutation(req);
    let input: unknown;
    try {
      input = await body(req);
    } catch (error) {
      if (error instanceof SyntaxError)
        throw new RequestBodyError("Restore requests must contain valid JSON.");
      throw error;
    }
    const { revisionId, baseRevisionId } = z
      .object({
        revisionId: z.string().min(1).max(80),
        baseRevisionId: z.string().min(1).max(80).nullable(),
      })
      .parse(input);
    const saved = restoreOwnedProject(
      (await params).id,
      revisionId,
      baseRevisionId,
      access.workspace.id,
    );
    return saved
      ? projectResponse(req, saved, access.workspace.id)
      : Response.json({ error: "Project not found." }, { status: 404 });
  } catch (error) {
    if (error instanceof SavedVersionUnavailable)
      return Response.json(
        {
          error:
            "This saved version cannot be restored. Its content or retained media is unavailable; your current film is unchanged.",
        },
        { status: 422 },
      );
    if (
      error instanceof RevisionConflict ||
      error instanceof RequestBodyError ||
      error instanceof ZodError
    )
      return failure(error);
    // A damaged stored document/service failure must not expose private JSON
    // or filesystem details through the ordinary mutation error helper.
    return Response.json(
      {
        error:
          "The saved version could not be restored. Your current film is unchanged; retry when ready.",
      },
      { status: 503 },
    );
  }
}
const restoreRoute = secureRoute(POSTHandler, "project");
export async function POST(request: Request, context: Context) {
  const response = await restoreRoute(request, context);
  response.headers.set("Cache-Control", "private, no-store");
  response.headers.set("X-Content-Type-Options", "nosniff");
  return response;
}
