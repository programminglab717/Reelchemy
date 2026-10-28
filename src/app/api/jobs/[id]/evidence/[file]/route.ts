import { readFile } from "node:fs/promises";
import path from "node:path";
import { artifactDir, getJob } from "@/lib/db";
export async function GET(
  _: Request,
  { params }: { params: Promise<{ id: string; file: string }> },
) {
  const { id, file } = await params;
  const job = getJob(id);
  if (
    !job ||
    !["completed", "failed"].includes(job.status) ||
    !/^(report\.json|thumbnail\.png|scene-(?:[1-9]|1[0-2])-(?:begin\.png|middle\.png|end\.png|event-[0-9]{1,3}\.png|motion\.mp4)|layout-(?:[1-9]|1[0-2])-(?:before|after)\.png)$/.test(
      file,
    )
  )
    return new Response(null, { status: 404 });
  try {
    const data = await readFile(path.join(artifactDir, job.id, file));
    return new Response(data, {
      headers: {
        "Content-Type": file.endsWith(".json")
          ? "application/json"
          : file.endsWith(".mp4")
            ? "video/mp4"
            : "image/png",
        "Cache-Control": "no-store",
      },
    });
  } catch {
    return new Response(null, { status: 404 });
  }
}
