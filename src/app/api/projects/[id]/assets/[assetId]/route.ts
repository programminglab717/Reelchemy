import { readFile } from "node:fs/promises";
import path from "node:path";
import { getProject } from "@/lib/db";
import { assetDir, validAssetId } from "@/lib/assets";
export async function GET(
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
        "Content-Type": "image/png",
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch {
    return new Response(null, { status: 404 });
  }
}
