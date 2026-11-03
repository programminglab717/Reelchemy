import { secureRoute } from "@/lib/access";
import { artifactDir, getJob } from "@/lib/db";
import { validAssetId } from "@/lib/project-assets";
import {
  privateFileMissing,
  privateFileResponse,
  privateFileRoute,
} from "@/lib/private-file";
async function GETHandler(
  req: Request,
  { params }: { params: Promise<{ id: string; file: string }> },
) {
  const { id, file } = await params;
  const job = getJob(id);
  if (
    !job ||
    job.files ||
    !validAssetId(job.id) ||
    !["completed", "failed"].includes(job.status) ||
    !/^(report\.json|captions\.srt|captions\.vtt|thumbnail\.png|scene-(?:[1-9]|1[0-2])-(?:begin\.png|middle\.png|end\.png|event-[0-9]{1,3}\.png|motion\.mp4)|layout-(?:[1-9]|1[0-2])-(?:before|after)\.png)$/.test(
      file,
    )
  )
    return privateFileMissing();
  return privateFileResponse(
    req,
    artifactDir,
    [job.id, file],
    file.endsWith(".srt") || file.endsWith(".vtt")
      ? "text/plain; charset=utf-8"
      : file.endsWith(".json")
        ? "application/json"
        : file.endsWith(".mp4")
          ? "video/mp4"
          : "image/png",
  );
}
export const GET = privateFileRoute(secureRoute(GETHandler, "job"));
export const HEAD = GET;
