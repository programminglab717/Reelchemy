import { secureRoute, type Access } from "@/lib/access";
import { z } from "zod";
import { createProject, listProjects } from "@/lib/db";
import { failure, body, localMutation } from "@/lib/http";
export const runtime = "nodejs";
async function GETHandler(_req: Request, _ctx: unknown, access: Access) {
  return Response.json(listProjects(access.workspace.id));
}
async function POSTHandler(req: Request, _ctx: unknown, access: Access) {
  try {
    localMutation(req);
    const brief = z
      .object({
        prompt: z.string().trim().min(3).max(1200),
        duration: z.number().int().min(5).max(60),
        format: z.enum(["landscape", "portrait", "square"]),
      })
      .parse(await body(req));
    return Response.json(createProject(brief, access.workspace.id), {
      status: 201,
    });
  } catch (e) {
    return failure(e);
  }
}

export const GET = secureRoute(GETHandler, "user");
export const POST = secureRoute(POSTHandler, "user");
