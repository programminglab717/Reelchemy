import { secureRoute } from "@/lib/access";
import { renameProject } from "@/lib/db";
import { body, failure, localMutation } from "@/lib/http";
import { z } from "zod";
async function PATCHHandler(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    localMutation(req);
    const { name, baseName } = z
      .object({
        name: z.string().trim().min(1).max(100),
        baseName: z.string().min(1).max(100),
      })
      .parse(await body(req));
    const p = renameProject((await params).id, name, baseName);
    return p
      ? Response.json(p)
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
export const PATCH = secureRoute(PATCHHandler, "project");
