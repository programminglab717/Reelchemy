import { secureRoute, type Access } from "@/lib/access";
import { activeStudioExports } from "@/lib/db";
import { activeExportLimit } from "@/lib/export-policy";
import { failure } from "@/lib/http";
function GETHandler(_request: Request, _context: unknown, access: Access) {
  try {
    return Response.json(
      {
        limit: activeExportLimit(),
        exports: activeStudioExports(access.workspace.id),
      },
      {
        headers: {
          "Cache-Control": "private, no-store",
          "X-Content-Type-Options": "nosniff",
        },
      },
    );
  } catch (error) {
    return failure(error);
  }
}
export const GET = secureRoute(GETHandler, "user");
