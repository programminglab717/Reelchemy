import { secureRoute, type Access } from "@/lib/access";
import { receiveMediaRequest } from "@/lib/media-processing-http";
async function POSTHandler(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
  access: Access,
) {
  return receiveMediaRequest(
    req,
    access.workspace.id,
    (await params).id,
    "upload",
  );
}
export const POST = secureRoute(POSTHandler, "project", { rate: "media" });
