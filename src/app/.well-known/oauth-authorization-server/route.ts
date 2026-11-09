import { oauthHeaders, studioOrigin } from "@/lib/mcp-oauth-http";

// RFC 8414 metadata for the studio's MCP authorization server.
export const dynamic = "force-dynamic";
export function GET(request: Request) {
  const origin = studioOrigin(request);
  return Response.json(
    {
      issuer: origin,
      authorization_endpoint: `${origin}/oauth/authorize`,
      token_endpoint: `${origin}/api/oauth/token`,
      registration_endpoint: `${origin}/api/oauth/register`,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none"],
      scopes_supported: ["studio"],
    },
    { headers: oauthHeaders },
  );
}
