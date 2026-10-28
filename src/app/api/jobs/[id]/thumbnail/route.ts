import { readFile } from "node:fs/promises";
import path from "node:path";
import { artifactDir, getJob } from "@/lib/db";
export async function GET(
  _: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const job = getJob((await params).id);
  if (job?.status !== "completed") return new Response(null, { status: 404 });
  return new Response(
    await readFile(path.join(artifactDir, job.id, "thumbnail.png")),
    { headers: { "Content-Type": "image/png" } },
  );
}
