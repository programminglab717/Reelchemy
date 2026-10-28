import { readFile } from "node:fs/promises";
import path from "node:path";
import { artifactDir, getJob } from "@/lib/db";
export async function GET(
  _: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const job = getJob((await params).id);
  if (job?.status !== "completed")
    return Response.json({ error: "Export is not available" }, { status: 404 });
  const buffer = await readFile(path.join(artifactDir, job.id, "video.mp4"));
  return new Response(buffer, {
    headers: {
      "Content-Type": "video/mp4",
      "Content-Disposition": `attachment; filename="reelchemy-${job.id}.mp4"`,
      "Content-Length": String(buffer.length),
      "Cache-Control": "no-store",
    },
  });
}
