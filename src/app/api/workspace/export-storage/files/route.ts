import { secureRoute, type Access } from "@/lib/access";
import { retainedExports } from "@/lib/db";
import { ExportHistoryUnavailable } from "@/lib/export-history";
import { privateFileRoute } from "@/lib/private-file";
function handler(request: Request, _context: unknown, { workspace }: Access) {
  try {
    const query = new URL(request.url).searchParams;
    if (
      [...query.keys()].some((key) => !["anchor", "before"].includes(key)) ||
      query.getAll("anchor").length > 1 ||
      query.getAll("before").length > 1
    )
      throw new ExportHistoryUnavailable();
    return Response.json(
      retainedExports(workspace.id, {
        ...(query.has("anchor") ? { anchor: query.get("anchor")! } : {}),
        ...(query.has("before") ? { before: query.get("before")! } : {}),
      }),
    );
  } catch (error) {
    return Response.json(
      {
        error:
          "Retained exports could not be loaded. Refresh to retry; your edits are kept.",
      },
      { status: error instanceof ExportHistoryUnavailable ? 422 : 503 },
    );
  }
}
export const GET = privateFileRoute(secureRoute(handler, "user"));
