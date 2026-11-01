import { secureRoute } from "@/lib/access";
import { getProject, requestOwnedWaveform } from "@/lib/db";
import { cachedWaveform } from "@/lib/waveform-cache";
import {
  privateMediaHeaders,
  safeMediaFailure,
} from "@/lib/media-processing-http";
async function GETHandler(
  _req: Request,
  { params }: { params: Promise<{ id: string; assetId: string }> },
  access: { workspace: { id: string } },
) {
  const { id, assetId } = await params;
  const asset = getProject(id)?.assets?.find((asset) => asset.id === assetId);
  if (
    !asset ||
    (asset.mime !== "audio/wav" &&
      !(asset.mime === "video/mp4" && asset.hasAudio))
  )
    return new Response(null, { status: 404, headers: privateMediaHeaders });
  try {
    let cached;
    try {
      cached = cachedWaveform(assetId);
    } catch {
      /* A bounded worker rebuild may repair a damaged cache. */
    }
    if (cached) return Response.json(cached, { headers: privateMediaHeaders });
    const request = requestOwnedWaveform(id, access.workspace.id, assetId);
    if (!request)
      return new Response(null, { status: 404, headers: privateMediaHeaders });
    if (["failed", "cancelled", "completed"].includes(request.state)) {
      const retryAfter = Math.max(
        1,
        Math.ceil(
          (300000 - (Date.now() - Date.parse(request.createdAt))) / 1000,
        ),
      );
      return Response.json(
        {
          error:
            "This waveform could not be prepared. Try again later; the original audio remains available.",
          code: "WAVEFORM_UNAVAILABLE",
          retryAfter,
        },
        {
          status: 422,
          headers: {
            ...privateMediaHeaders,
            "Retry-After": String(retryAfter),
          },
        },
      );
    }
    return Response.json(
      { requestId: request.id, state: request.state },
      { status: 202, headers: { ...privateMediaHeaders, "Retry-After": "1" } },
    );
  } catch (error) {
    return safeMediaFailure(error);
  }
}
export const GET = secureRoute(GETHandler, "project");
