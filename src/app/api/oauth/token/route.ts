import { mcpOAuth, mcpTokens, ownedWorkspace } from "@/lib/db";
import { readLimitedBody } from "@/lib/http";
import { OAUTH_ACCESS_SECONDS } from "@/lib/mcp-tokens";
import { oauthError, oauthHeaders } from "@/lib/mcp-oauth-http";

// Token endpoint: authorization codes (with the PKCE verifier) and refresh
// tokens for registered public clients.
export const runtime = "nodejs";
async function parameters(request: Request) {
  const text = new TextDecoder().decode(await readLimitedBody(request, 16384));
  if (
    (request.headers.get("content-type") ?? "").includes("application/json")
  ) {
    const value = JSON.parse(text) as Record<string, unknown>;
    return new URLSearchParams(
      Object.entries(value).map(([k, v]) => [k, String(v)]),
    );
  }
  return new URLSearchParams(text);
}
const tokens = (access: string, refresh: string) =>
  Response.json(
    {
      access_token: access,
      token_type: "Bearer",
      expires_in: OAUTH_ACCESS_SECONDS,
      refresh_token: refresh,
      scope: "studio",
    },
    { headers: oauthHeaders },
  );
export async function POST(request: Request) {
  let params: URLSearchParams;
  try {
    params = await parameters(request);
  } catch {
    return oauthError("invalid_request", "Send the token request as a form.");
  }
  const clientId = params.get("client_id") ?? "";
  const client = mcpOAuth.client(clientId);
  if (!client) return oauthError("invalid_client", "Unknown client_id.", 401);
  const grant = params.get("grant_type");
  if (grant === "authorization_code") {
    const granted = mcpOAuth.redeem({
      code: params.get("code") ?? "",
      clientId,
      redirectUri: params.get("redirect_uri") ?? "",
      verifier: params.get("code_verifier") ?? "",
    });
    if (!granted)
      return oauthError(
        "invalid_grant",
        "The code is invalid, expired or already used, or the PKCE verifier or redirect URI does not match.",
      );
    const workspace = ownedWorkspace(granted.userId);
    if (!workspace || workspace.id !== granted.workspaceId)
      return oauthError("invalid_grant", "This studio is not available.");
    try {
      const t = mcpTokens.connect(
        workspace.id,
        granted.userId,
        clientId,
        client.name,
      );
      return tokens(t.access, t.refresh);
    } catch (error) {
      return oauthError(
        "invalid_request",
        error instanceof Error ? error.message : "Could not connect.",
      );
    }
  }
  if (grant === "refresh_token") {
    const t = mcpTokens.refresh(params.get("refresh_token") ?? "", clientId);
    return t
      ? tokens(t.access, t.refresh)
      : oauthError("invalid_grant", "The refresh token is invalid or expired.");
  }
  return oauthError(
    "unsupported_grant_type",
    "Use authorization_code or refresh_token.",
  );
}
export function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      ...oauthHeaders,
      "Access-Control-Allow-Methods": "POST",
      "Access-Control-Allow-Headers": "content-type",
    },
  });
}
