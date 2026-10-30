import { secureRoute, type Access } from "@/lib/access";
import { z } from "zod";
import {
  createProject,
  listProjects,
  listProjectSummaries,
  countProjects,
  reviseProject,
} from "@/lib/db";
import { blankTimeline } from "@/lib/editor";
import { failure, body, localMutation } from "@/lib/http";
export const runtime = "nodejs";
async function GETHandler(req: Request, _ctx: unknown, access: Access) {
  try {
    const search = new URL(req.url).searchParams;
    const { query, offset, limit, trashed, view } = z
      .object({
        query: z.string().trim().max(100),
        offset: z.coerce.number().int().min(0).max(100000),
        limit: z.coerce.number().int().min(1).max(50),
        view: z.enum(["full", "summary"]),
        trashed: z
          .enum(["true", "false"])
          .transform((value) => value === "true"),
      })
      .parse({
        query: search.get("q") || "",
        offset: search.get("offset") || 0,
        limit: search.get("limit") || 50,
        view: search.get("view") || "full",
        trashed: search.get("trashed") || "false",
      });
    const count = countProjects(access.workspace.id, query, trashed);
    const projects = (view === "summary" ? listProjectSummaries : listProjects)(
      access.workspace.id,
      {
        query,
        offset,
        limit,
        trashed,
      },
    );
    return Response.json(projects, {
      headers: {
        "Cache-Control": "private, no-store",
        "X-Total-Count": String(count),
        ...(offset + projects.length < count
          ? { "X-Next-Offset": String(offset + projects.length) }
          : {}),
      },
    });
  } catch (e) {
    return failure(e);
  }
}
async function POSTHandler(req: Request, _ctx: unknown, access: Access) {
  try {
    localMutation(req);
    const brief = z
      .object({
        prompt: z.string().trim().min(3).max(1200),
        duration: z.number().int().min(5).max(60),
        format: z.enum(["landscape", "portrait", "square"]),
        blank: z.boolean().optional(),
      })
      .parse(await body(req));
    const p = createProject(
      { prompt: brief.prompt, duration: brief.duration, format: brief.format },
      access.workspace.id,
    );
    if (brief.blank) reviseProject(p, blankTimeline(brief), "Blank canvas");
    return Response.json(p, {
      status: 201,
    });
  } catch (e) {
    return failure(e);
  }
}

export const GET = secureRoute(GETHandler, "user");
export const POST = secureRoute(POSTHandler, "user");
