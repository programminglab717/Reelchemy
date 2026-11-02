import { secureRoute } from "@/lib/access";
import { projectVersionPage, projectVersionSnapshot } from "@/lib/db";
import { SavedVersionUnavailable } from "@/lib/project-history";
const privateHeaders = {
  "Cache-Control": "private, no-store",
  "X-Content-Type-Options": "nosniff",
};
const readHistory = secureRoute(async (req, { params }, access) => {
  const id = (await params).id;
  const query = new URL(req.url).searchParams;
  const revision = query.get("revisionId"),
    offset = query.get("offset") || "0";
  if (
    (revision !== null &&
      (!revision ||
        revision.length > 80 ||
        /[\x00-\x1f\x7f]/.test(revision))) ||
    (revision === null && !/^(0|[1-9]\d{0,8})$/.test(offset))
  )
    return Response.json(
      { error: "Choose a valid saved version or page." },
      { status: 400, headers: privateHeaders },
    );
  try {
    const result =
      revision !== null
        ? projectVersionSnapshot(id, access.workspace.id, revision)
        : projectVersionPage(id, access.workspace.id, Number(offset));
    return result
      ? Response.json(result, { headers: privateHeaders })
      : Response.json(
          { error: "Saved version not found." },
          { status: 404, headers: privateHeaders },
        );
  } catch (error) {
    const unavailable = error instanceof SavedVersionUnavailable;
    if (!unavailable) console.error("PROJECT_HISTORY_UNAVAILABLE");
    return Response.json(
      {
        error: unavailable
          ? "This saved history could not be read. Try another version or download the project archive for recovery."
          : "Saved history is temporarily unavailable. Try again.",
      },
      { status: unavailable ? 422 : 503, headers: privateHeaders },
    );
  }
}, "project");
export async function GET(
  req: Request,
  context: { params: Promise<{ id: string }> },
) {
  const response = await readHistory(req, context);
  for (const [name, value] of Object.entries(privateHeaders))
    response.headers.set(name, value);
  return response;
}
