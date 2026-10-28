import { getAuth } from "@/lib/auth";
import { readLimitedBody } from "@/lib/http";
export const runtime = "nodejs";
export async function GET(req: Request) {
  try {
    return await (await getAuth()).handler(req);
  } catch {
    return Response.json(
      { error: "Authentication service is not configured or available." },
      { status: 503 },
    );
  }
}
export async function POST(req: Request) {
  try {
    const bytes = await readLimitedBody(req, 16000);
    return await (
      await getAuth()
    ).handler(
      new Request(req.url, {
        method: "POST",
        headers: req.headers,
        body: bytes,
      }),
    );
  } catch {
    return Response.json(
      { error: "Authentication request could not be processed." },
      { status: 400 },
    );
  }
}
