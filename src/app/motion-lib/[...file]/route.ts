import { serveMotionFile } from "@/motion/motion-files";

// Public, allowlisted libraries and fonts for code-scene previews. Scene
// documents run in an opaque-origin sandbox, so these are cross-origin loads.
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ file: string[] }> },
) {
  const name = (await params).file.join("/");
  const file = serveMotionFile(name);
  if (!file)
    return new Response("Not found", {
      status: 404,
      headers: { "Cache-Control": "no-store" },
    });
  const { bytes, type } = file;
  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": type,
      "Cache-Control": "public, max-age=3600",
      "X-Content-Type-Options": "nosniff",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
