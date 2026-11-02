import { projectResponse, privateProjectHeaders } from "@/lib/project-http";
import { secureRoute, type Access } from "@/lib/access";
import { renameOwnedProject } from "@/lib/db";
import { body, failure, localMutation } from "@/lib/http";
import { z } from "zod";
async function PATCHHandler(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
  access: Access,
) {
  try {
    localMutation(req);
    const { name, baseName } = z
      .object({
        name: z.string().trim().min(1).max(100),
        baseName: z.string().min(1).max(100),
      })
      .parse(await body(req));
    const p = renameOwnedProject(
      (await params).id,
      name,
      baseName,
      access.workspace.id,
    );
    if (p === undefined)
      return Response.json({ error: "Project not found." }, { status: 404 });
    return p
      ? projectResponse(req, p, access.workspace.id)
      : Response.json(
          {
            error:
              "This project was renamed in another session. Reopen it to see the latest name before renaming again.",
            code: "NAME_CONFLICT",
          },
          { status: 409 },
        );
  } catch (e) {
    return failure(e);
  }
}
const renameRoute = secureRoute(PATCHHandler, "project");
export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const response = await renameRoute(request, context);
  for (const [name, value] of Object.entries(privateProjectHeaders))
    response.headers.set(name, value);
  return response;
}
