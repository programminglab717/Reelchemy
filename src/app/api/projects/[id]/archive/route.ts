import { secureRoute } from "@/lib/access";
import { getProject } from "@/lib/db";
import { exportArchive } from "@/lib/archive";
import { failure } from "@/lib/http";
async function GETHandler(
  _: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const p = getProject((await params).id);
    if (!p)
      return Response.json({ error: "Project not found" }, { status: 404 });
    const zip = await exportArchive(p);
    return new Response(zip, {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="reelchemy-${p.id}.zip"`,
        "Content-Length": String(zip.byteLength),
      },
    });
  } catch (e) {
    return failure(e);
  }
}

const archiveRoute = secureRoute(GETHandler, "project");
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const response = await archiveRoute(request, context);
  response.headers.set("Cache-Control", "private, no-store");
  response.headers.set("X-Content-Type-Options", "nosniff");
  return response;
}
