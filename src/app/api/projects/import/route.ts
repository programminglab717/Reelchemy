import { secureRoute, type Access } from "@/lib/access";
import { receiveMediaRequest } from "@/lib/media-processing-http";
async function POSTHandler(req: Request, _ctx: unknown, access: Access) {
  return receiveMediaRequest(req, access.workspace.id, null, "import");
}
export const POST = secureRoute(POSTHandler, "user", { rate: "media" });
