import { getAuth } from "@/lib/auth";
import { readLimitedBody, RequestBodyError } from "@/lib/http";
import { ACCOUNT_HEADER, accountMismatch } from "@/lib/account-session";
export const runtime = "nodejs";
function privateResponse(response: Response) {
  response.headers.set("Cache-Control", "private, no-store");
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}
async function boundAccount(
  req: Request,
  auth: Awaited<ReturnType<typeof getAuth>>,
) {
  if (!req.headers.has(ACCOUNT_HEADER)) return;
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session?.user)
    return Response.json(
      { error: "Sign in to continue.", code: "ACCOUNT_EXPIRED" },
      { status: 401, headers: { "Cache-Control": "private, no-store" } },
    );
  return accountMismatch(req.headers, session.user.id);
}
export async function GET(req: Request) {
  try {
    const auth = await getAuth();
    const mismatch = await boundAccount(req, auth);
    return privateResponse(mismatch || (await auth.handler(req)));
  } catch {
    return Response.json(
      { error: "Authentication service is not configured or available." },
      { status: 503, headers: { "Cache-Control": "private, no-store" } },
    );
  }
}
export async function POST(req: Request) {
  try {
    const origin = req.headers.get("origin");
    if (
      origin &&
      new URL(origin).origin !==
        new URL(process.env.BETTER_AUTH_URL || "http://127.0.0.1:3001").origin
    )
      return Response.json(
        { error: "Cross-origin authentication requests are not allowed." },
        { status: 403, headers: { "Cache-Control": "private, no-store" } },
      );
    const auth = await getAuth();
    // Match this exact request's cookie before reading its body or invoking
    // any auth action. Bound session reads and mutations share one contract.
    const mismatch = await boundAccount(req, auth);
    if (mismatch) return mismatch;
    const bytes = await readLimitedBody(req, 16000, { timeoutMs: 15000 });
    return privateResponse(
      await auth.handler(
        new Request(req.url, {
          method: "POST",
          headers: req.headers,
          body: bytes,
        }),
      ),
    );
  } catch (error) {
    const interrupted =
      error instanceof RequestBodyError && error.status === 408;
    return Response.json(
      {
        error: interrupted
          ? "Authentication request did not finish. Try again."
          : "Authentication request could not be processed.",
      },
      {
        status: interrupted ? 408 : 400,
        headers: { "Cache-Control": "private, no-store" },
      },
    );
  }
}
