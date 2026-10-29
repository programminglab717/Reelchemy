import { secureRoute } from "@/lib/access";
import { stat } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import { byteRange } from "@/lib/media-range";
import path from "node:path";
import { getProject } from "@/lib/db";
import { assetDir, validAssetId } from "@/lib/assets";
async function GETHandler(
  req: Request,
  { params }: { params: Promise<{ id: string; assetId: string }> },
) {
  const { id, assetId } = await params;
  const p = getProject(id);
  if (!validAssetId(assetId) || !p?.assets?.some((a) => a.id === assetId))
    return new Response(null, { status: 404 });
  try {
    const file = path.join(assetDir, assetId),
      size = (await stat(file)).size;
    let range;
    try {
      range = byteRange(req.headers.get("range"), size);
    } catch {
      return new Response(null, {
        status: 416,
        headers: {
          "Content-Range": `bytes */${size}`,
          "Cache-Control": "private, no-store",
        },
      });
    }
    const headers: Record<string, string> = {
      "Content-Type": p.assets!.find((a) => a.id === assetId)!.mime,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
      "Accept-Ranges": "bytes",
      "Content-Length": String(range ? range.end - range.start + 1 : size),
    };
    if (range)
      headers["Content-Range"] = `bytes ${range.start}-${range.end}/${size}`;
    return new Response(
      Readable.toWeb(
        createReadStream(file, range || undefined),
      ) as ReadableStream<Uint8Array>,
      {
        status: range ? 206 : 200,
        headers,
      },
    );
  } catch {
    return new Response(null, { status: 404 });
  }
}

export const GET = secureRoute(GETHandler, "project");
