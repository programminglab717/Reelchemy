import { secureRoute, type Access } from "@/lib/access";
import {
  createOwnedJob,
  getProject,
  listJobs,
  projectExportPage,
} from "@/lib/db";
import { ExportHistoryUnavailable } from "@/lib/export-history";
import { readLimitedBody, failure, localMutation } from "@/lib/http";
import { z } from "zod";
async function POSTHandler(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
  access: Access,
) {
  try {
    localMutation(req);
    const { id } = await params;
    // IncomingMessage-backed requests can expose an empty readable body rather
    // than null. Both forms are the supported bodyless export API.
    const bytes = await readLimitedBody(req, 100000);
    const input = z
      .object({
        baseRevisionId: z.string().min(1).max(80).nullable().optional(),
      })
      .parse(bytes.length ? JSON.parse(new TextDecoder().decode(bytes)) : {});
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
  req: Request,
  { params }: { params: Promise<{ id: string }> },
  access: Access,
) {
  const { id } = await params;
  const query = new URL(req.url).searchParams;
  if (query.has("view")) {
    if (
      query.get("view") !== "history" ||
      [...query.keys()].some(
        (key) => !["view", "anchor", "before"].includes(key),
      ) ||
      ["view", "anchor", "before"].some((key) => query.getAll(key).length > 1)
    )
      return Response.json(
        { error: "Choose a valid export history page." },
        { status: 400 },
      );
    const cursor: { anchor?: string; before?: string } = {};
    for (const key of ["anchor", "before"] as const) {
      const raw = query.get(key);
      if (raw !== null) {
        if (!/^v1\.[A-Za-z0-9_-]{48,60}$/.test(raw))
          return Response.json(
            { error: "Choose a valid export history page." },
            { status: 400 },
          );
        cursor[key] = raw;
      }
    }
    if (cursor.before && !cursor.anchor)
      return Response.json(
        { error: "Choose a valid export history page." },
        { status: 400 },
      );
    try {
      const page = projectExportPage(id, access.workspace.id, cursor);
      return page
        ? Response.json(page)
        : Response.json({ error: "Project not found" }, { status: 404 });
    } catch (error) {
      return Response.json(
        { error: "Export history is unavailable. Try again." },
        { status: error instanceof ExportHistoryUnavailable ? 422 : 503 },
      );
    }
  }
  if (!getProject(id))
    return Response.json({ error: "Project not found" }, { status: 404 });
  return Response.json(listJobs(id));
}

export const POST = secureRoute(POSTHandler, "project", { rate: "render" });
const readExports = secureRoute(GETHandler, "project");
export async function GET(
  req: Request,
  context: { params: Promise<{ id: string }> },
) {
  const response = await readExports(req, context);
  response.headers.set("Cache-Control", "private, no-store");
  response.headers.set("X-Content-Type-Options", "nosniff");
  return response;
}
