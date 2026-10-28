import { getProject } from "@/lib/db";
import { exportArchive } from "@/lib/archive";
import { failure } from "@/lib/http";
export async function GET(
  _: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const p = getProject((await params).id);
    if (!p)
      return Response.json({ error: "Project not found" }, { status: 404 });
    return new Response(await exportArchive(p), {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="reelchemy-${p.id}.zip"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    return failure(e);
  }
}
