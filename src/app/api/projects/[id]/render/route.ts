import { secureRoute, type Access } from "@/lib/access";
import { createOwnedJob, getProject, listJobs } from "@/lib/db";
import { body, failure, localMutation } from "@/lib/http";
import { z } from "zod";
async function POSTHandler(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
  access: Access,
) {
  try {
    localMutation(req);
    const { id } = await params;
    const input = z
      .object({
        baseRevisionId: z.string().min(1).max(80).nullable().optional(),
      })
      .parse(req.body ? await body(req) : {});
    const key = z
      .string()
      .uuid()
      .optional()
      .parse(req.headers.get("idempotency-key") ?? undefined);
    const result = createOwnedJob(id, access.workspace.id, { ...input, key });
    if (!result)
      return Response.json({ error: "Project not found" }, { status: 404 });
    return Response.json(result.job, {
      status: 202,
      headers: {
        "Cache-Control": "private, no-store",
        "Idempotency-Replayed": String(result.replayed),
      },
    });
  } catch (e) {
    return failure(e);
  }
}

async function GETHandler(
  _: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!getProject(id))
    return Response.json({ error: "Project not found" }, { status: 404 });
  return Response.json(listJobs(id));
}

export const POST = secureRoute(POSTHandler, "project", { rate: "render" });
export const GET = secureRoute(GETHandler, "project");
