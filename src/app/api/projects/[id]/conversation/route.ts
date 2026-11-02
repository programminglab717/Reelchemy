import { secureRoute, type Access } from "@/lib/access";
import { projectConversationPage } from "@/lib/db";
import { privateProjectHeaders } from "@/lib/project-http";
import { z } from "zod";
type Context = { params: Promise<{ id: string }> };
async function GETHandler(request: Request, context: Context, access: Access) {
  const search = new URL(request.url).searchParams;
  if (
    [...search.keys()].some((key) => key !== "before") ||
    search.getAll("before").length > 1
  )
    return Response.json(
      { error: "Invalid conversation cursor." },
      { status: 400 },
    );
  const cursor = search.has("before")
    ? z.coerce
        .number()
        .int()
        .min(0)
        .max(Number.MAX_SAFE_INTEGER)
        .safeParse(search.get("before"))
    : undefined;
  if (cursor && !cursor.success)
    return Response.json(
      { error: "Invalid conversation cursor." },
      { status: 400 },
    );
  try {
    const page = projectConversationPage(
      (await context.params).id,
      access.workspace.id,
      cursor?.data,
    );
    return page
      ? Response.json(page)
      : Response.json({ error: "Project not found." }, { status: 404 });
  } catch {
    return Response.json(
      {
        error:
          "Saved directions could not be loaded. Your current edit is still here; retry when ready.",
      },
      { status: 503 },
    );
  }
}
const conversationRoute = secureRoute(GETHandler, "project");
export async function GET(request: Request, context: Context) {
  const response = await conversationRoute(request, context);
  for (const [name, value] of Object.entries(privateProjectHeaders))
    response.headers.set(name, value);
  return response;
}
