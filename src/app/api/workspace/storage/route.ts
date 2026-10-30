import { secureRoute, type Access } from "@/lib/access";
import { mediaStorage } from "@/lib/db";
import { failure } from "@/lib/http";
function GETHandler(_request: Request, _context: unknown, access: Access) {
  try {
    return Response.json(mediaStorage(access.workspace.id), {
      headers: {
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return failure(error);
  }
}
export const GET = secureRoute(GETHandler, "user");
