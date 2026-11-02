import { secureRoute, type Access } from "@/lib/access";
import {
  receiveMediaRequest,
  privateMediaHeaders,
} from "@/lib/media-processing-http";
import { projectMediaCatalogue } from "@/lib/db";
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
const getCatalogue = secureRoute(async (_req, { params }, access) => {
  try {
    const catalogue = projectMediaCatalogue(
      (await params).id,
      access.workspace.id,
    );
    return catalogue
      ? Response.json(catalogue, { headers: privateMediaHeaders })
      : Response.json(
          { error: "Project not found." },
          { status: 404, headers: privateMediaHeaders },
        );
  } catch {
    console.error("MEDIA_CATALOGUE_UNAVAILABLE");
    return Response.json(
      { error: "Media details are temporarily unavailable. Try again." },
      { status: 503, headers: privateMediaHeaders },
    );
  }
}, "project");
export async function GET(
  req: Request,
  context: { params: Promise<{ id: string }> },
) {
  const response = await getCatalogue(req, context);
  for (const [name, value] of Object.entries(privateMediaHeaders))
    response.headers.set(name, value);
  return response;
}
