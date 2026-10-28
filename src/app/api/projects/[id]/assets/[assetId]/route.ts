import { secureRoute } from "@/lib/access";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { getProject } from "@/lib/db";
import { assetDir, validAssetId } from "@/lib/assets";
async function GETHandler(
  _: Request,
  { params }: { params: Promise<{ id: string; assetId: string }> },
) {
  const { id, assetId } = await params;
  const p = getProject(id);
  if (!validAssetId(assetId) || !p?.assets?.some((a) => a.id === assetId))
    return new Response(null, { status: 404 });
  try {
    return new Response(await readFile(path.join(assetDir, assetId)), {
      headers: {
        "Content-Type": p.assets!.find((a) => a.id === assetId)!.mime,
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, no-store",
      },
    });
  } catch {
    return new Response(null, { status: 404 });
  }
}

export const GET = secureRoute(GETHandler, "project");
