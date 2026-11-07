import { isMotionFile } from "@/motion/libraries";
import { readMotionFile } from "@/motion/motion-files";

// Public, allowlisted libraries and fonts for code-scene previews. Scene
// documents run in an opaque-origin sandbox, so these are cross-origin loads.
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ file: string[] }> },
) {
  const name = (await params).file.join("/");
  if (!isMotionFile(name))
    return new Response("Not found", {
      status: 404,
      headers: { "Cache-Control": "no-store" },
    });
  const { bytes, type } = readMotionFile(name);
  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": type,
      "Cache-Control": "public, max-age=3600",
      "X-Content-Type-Options": "nosniff",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
