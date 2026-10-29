import { readiness } from "@/lib/health";
export const dynamic = "force-dynamic";
export async function GET() {
  const result = await readiness();
  return Response.json(result, {
    status: result.status === "ready" ? 200 : 503,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
