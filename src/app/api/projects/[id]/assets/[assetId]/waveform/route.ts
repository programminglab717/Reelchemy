import { secureRoute } from "@/lib/access";
import { getProject } from "@/lib/db";
import { readWaveform, WaveformBusy } from "@/lib/waveform";
async function GETHandler(
  _req: Request,
  { params }: { params: Promise<{ id: string; assetId: string }> },
) {
  const { id, assetId } = await params;
  const asset = getProject(id)?.assets?.find((a) => a.id === assetId);
  if (
    !asset ||
    (asset.mime !== "audio/wav" &&
      !(asset.mime === "video/mp4" && asset.hasAudio))
  )
    return new Response(null, { status: 404 });
  const headers = {
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
  };
  try {
    return Response.json(await readWaveform(assetId), { headers });
  } catch (e) {
    return Response.json(
      {
        error:
          e instanceof WaveformBusy
            ? e.message
            : "Could not read this audio waveform.",
      },
      {
        status: e instanceof WaveformBusy ? 429 : 422,
        headers: {
          ...headers,
          ...(e instanceof WaveformBusy ? { "Retry-After": "2" } : {}),
        },
      },
    );
  }
}
export const GET = secureRoute(GETHandler, "project");
