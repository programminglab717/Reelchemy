import { secureRoute, type Access } from "@/lib/access";
import { jobHistoryRecords } from "@/lib/db";
import { JobHistoryPageUnavailable } from "@/lib/job-history-page";
import { privateFileRoute } from "@/lib/private-file";
function handler(request: Request, _context: unknown, { workspace }: Access) {
  try {
    const query = new URL(request.url).searchParams;
    if (
      [...query.keys()].some((key) => !["anchor", "before"].includes(key)) ||
      query.getAll("anchor").length > 1 ||
      query.getAll("before").length > 1
    )
      throw new JobHistoryPageUnavailable();
    return Response.json(
      jobHistoryRecords(workspace.id, {
        ...(query.has("anchor") ? { anchor: query.get("anchor")! } : {}),
        ...(query.has("before") ? { before: query.get("before")! } : {}),
      }),
    );
  } catch (error) {
    return Response.json(
      {
        error:
          "Export activity could not be loaded. Refresh to retry; your edits are kept.",
      },
      { status: error instanceof JobHistoryPageUnavailable ? 422 : 503 },
    );
  }
}
export const GET = privateFileRoute(secureRoute(handler, "user"));
