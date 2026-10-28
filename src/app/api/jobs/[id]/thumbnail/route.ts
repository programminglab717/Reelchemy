import { secureRoute } from "@/lib/access";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { artifactDir, getJob } from "@/lib/db";
async function GETHandler(
  _: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const job = getJob((await params).id);
  if (job?.status !== "completed") return new Response(null, { status: 404 });
  return new Response(
    await readFile(path.join(artifactDir, job.id, "thumbnail.png")),
    {
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "private, no-store",
      },
    },
  );
}

export const GET = secureRoute(GETHandler, "job");
