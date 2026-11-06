import { secureRoute, type Access } from "@/lib/access";
import { mediaLibrary, projectInWorkspace } from "@/lib/db";
import { z } from "zod";
import { libraryProjectId } from "@/lib/media-library";
export const runtime = "nodejs";
function GETHandler(req: Request, _context: unknown, access: Access) {
  const search = new URL(req.url).searchParams;
  const parsed = z
    .object({
      query: z.string().trim().max(100),
      kind: z.enum(["all", "image", "audio", "video", "font"]),
      offset: z.coerce.number().int().min(0).max(100000),
      limit: z.coerce.number().int().min(1).max(50),
      targetProjectId: libraryProjectId.optional(),
    })
    .safeParse({
      query: search.get("q") || "",
      kind: search.get("kind") || "all",
      offset: search.get("offset") || "0",
      limit: search.get("limit") || "20",
      targetProjectId: search.get("projectId") ?? undefined,
    });
  const headers = {
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
  };
  if (!parsed.success)
    return Response.json(
      { error: "Choose a valid media search, type and page." },
      { status: 400, headers },
    );
  try {
    if (
      parsed.data.targetProjectId &&
      !projectInWorkspace(parsed.data.targetProjectId, access.workspace.id)
    )
      return Response.json(
        { error: "Project not found." },
        { status: 404, headers },
      );
    return Response.json(mediaLibrary(access.workspace.id, parsed.data), {
      headers,
    });
  } catch {
    return Response.json(
      { error: "The media library could not be loaded. Try again." },
      { status: 503, headers },
    );
  }
}
export const GET = secureRoute(GETHandler, "user");
