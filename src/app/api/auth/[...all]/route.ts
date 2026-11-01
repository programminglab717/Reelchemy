import { getAuth } from "@/lib/auth";
import { readLimitedBody } from "@/lib/http";
import { ACCOUNT_HEADER, accountMismatch } from "@/lib/account-session";
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
    const auth = await getAuth();
    // Check the cookie on this exact sign-out request. A separate preflight
    // could race another tab changing the cookie before sign-out is sent.
    if (
      new URL(req.url).pathname === "/api/auth/sign-out" &&
      req.headers.has(ACCOUNT_HEADER)
    ) {
      const session = await auth.api.getSession({ headers: req.headers });
      if (session?.user) {
        const mismatch = accountMismatch(req.headers, session.user.id);
        if (mismatch) return mismatch;
      }
    }
    const bytes = await readLimitedBody(req, 16000);
    return await auth.handler(
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
