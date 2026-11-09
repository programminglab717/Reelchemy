import { ensureWorkspace, mcpTokens } from "@/lib/db";
import { readLimitedBody } from "@/lib/http";
import { handleMcpMessage } from "@/mcp/server";

// The studio's MCP endpoint (Streamable HTTP, stateless): AI assistants
// such as Claude or ChatGPT connect with a personal access token created in
// Account settings, and act for that studio only.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const MAX_MESSAGE_BYTES = 2 * 1024 * 1024;
const headers = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
};
const challenge = (request: Request, error: string, status = 401) =>
  Response.json(
    { error },
    {
      status,
      headers: {
        ...headers,
        "WWW-Authenticate": `Bearer realm="reelchemy", error="invalid_token", resource_metadata="${publicOrigin(request)}/.well-known/oauth-protected-resource"`,
      },
    },
  );
function publicOrigin(request: Request) {
  try {
    if (process.env.BETTER_AUTH_URL)
      return new URL(process.env.BETTER_AUTH_URL).origin;
  } catch {}
  return new URL(request.url).origin;
}
export async function POST(request: Request) {
  // Browsers on other sites may not drive the endpoint (DNS rebinding and
  // cross-site requests); assistants' servers send no Origin.
  const origin = request.headers.get("origin");
  if (origin) {
    let host = "";
    try {
      host = new URL(origin).host;
    } catch {}
    if (
      host !== request.headers.get("host") &&
      origin !== publicOrigin(request)
    )
      return Response.json(
        { error: "Cross-origin requests are not allowed." },
        { status: 403, headers },
      );
  }
  const authorization = request.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(\S+)$/i.exec(authorization);
  if (!match)
    return challenge(
      request,
      "Connect with a Reelchemy assistant token (Account settings → AI assistants) in an Authorization: Bearer header.",
    );
  const token = mcpTokens.resolve(match[1]);
  if (!token)
    return challenge(
      request,
      "This assistant token is not valid or was revoked.",
    );
  let workspace;
  try {
    workspace = ensureWorkspace(token.userId, token.name);
  } catch {
    return challenge(request, "This studio is not available.", 403);
  }
  if (workspace.id !== token.workspaceId)
    return challenge(
      request,
      "This assistant token is not valid or was revoked.",
    );
  let payload: unknown;
  try {
    payload = JSON.parse(
      new TextDecoder().decode(
        await readLimitedBody(request, MAX_MESSAGE_BYTES),
      ),
    );
  } catch {
    return Response.json(
      {
        jsonrpc: "2.0",
        id: null,
        error: { code: -32700, message: "Parse error." },
      },
      { status: 400, headers },
    );
  }
  const reply = await handleMcpMessage(payload, {
    access: {
      workspace,
      user: { id: token.userId, name: token.name, email: "" },
    },
    origin: publicOrigin(request),
  });
  if (reply === null) return new Response(null, { status: 202, headers });
  return Response.json(reply, { headers });
}
// No server-initiated stream and no sessions: every call is a POST.
const notAllowed = () =>
  new Response(null, { status: 405, headers: { ...headers, Allow: "POST" } });
export const GET = notAllowed;
export const DELETE = notAllowed;
