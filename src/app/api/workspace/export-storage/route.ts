import { secureRoute, type Access } from "@/lib/access";
import { exportStorage } from "@/lib/db";
import { failure } from "@/lib/http";
import { privateFileRoute } from "@/lib/private-file";
function handler(_request: Request, _context: unknown, { workspace }: Access) {
  try {
    return Response.json(exportStorage(workspace.id));
  } catch (error) {
    return failure(error);
  }
}
export const GET = privateFileRoute(secureRoute(handler, "user"));
