import { secureRoute, type Access } from "@/lib/access";
import { ownedProjectDeletions } from "@/lib/db";
import { z, ZodError } from "zod";
import { failure } from "@/lib/http";
function GETHandler(request: Request, _context: unknown, access: Access) {
  try {
    const offset = z.coerce
      .number()
      .int()
      .min(0)
      .max(1000000)
      .parse(new URL(request.url).searchParams.get("offset") || "0");
    return Response.json(ownedProjectDeletions(access.workspace.id, offset), {
      headers: {
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    if (error instanceof ZodError) {
      const response = failure(error);
      response.headers.set("Cache-Control", "private, no-store");
      return response;
    }
    return Response.json(
      { error: "Project cleanup status is temporarily unavailable." },
      { status: 503, headers: { "Cache-Control": "private, no-store" } },
    );
  }
}
export const GET = secureRoute(GETHandler, "user");
