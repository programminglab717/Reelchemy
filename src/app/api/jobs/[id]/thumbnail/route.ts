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
  { params }: { params: Promise<{ id: string }> },
) {
  const job = getJob((await params).id);
  if (job?.status !== "completed" || !validAssetId(job.id))
    return privateFileMissing();
  return privateFileResponse(
    req,
    artifactDir,
    [job.id, "thumbnail.png"],
    "image/png",
  );
}
export const GET = privateFileRoute(secureRoute(GETHandler, "job"));
export const HEAD = GET;
