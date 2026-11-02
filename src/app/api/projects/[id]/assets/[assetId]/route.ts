import { secureRoute } from "@/lib/access";
import { getProject } from "@/lib/db";
import { assetDir, validAssetId } from "@/lib/assets";
import {
  privateFileMissing,
  privateFileResponse,
  privateFileRoute,
} from "@/lib/private-file";
async function GETHandler(
  req: Request,
  { params }: { params: Promise<{ id: string; assetId: string }> },
) {
  const { id, assetId } = await params;
  const project = getProject(id),
    asset = project?.assets?.find((a) => a.id === assetId);
  if (
    !validAssetId(assetId) ||
    !asset ||
    !["image/png", "audio/wav", "video/mp4"].includes(asset.mime)
  )
    return privateFileMissing();
  return privateFileResponse(req, assetDir, [assetId], asset.mime);
}
export const GET = privateFileRoute(secureRoute(GETHandler, "project"));
export const HEAD = GET;
