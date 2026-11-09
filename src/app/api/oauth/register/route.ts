import { z } from "zod";
import { mcpOAuth } from "@/lib/db";
import { readLimitedBody } from "@/lib/http";
import { oauthError, oauthHeaders } from "@/lib/mcp-oauth-http";

// RFC 7591 dynamic registration of public MCP clients (PKCE, no secret).
// Registering grants nothing: the owner still approves each connection.
export const runtime = "nodejs";
export async function POST(request: Request) {
  let input;
  try {
    input = z
      .object({
        client_name: z.string().max(200).optional(),
        redirect_uris: z.array(z.string().max(500)).min(1).max(5),
        token_endpoint_auth_method: z.literal("none").optional(),
      })
      .parse(
        JSON.parse(
          new TextDecoder().decode(await readLimitedBody(request, 16384)),
        ),
      );
  } catch {
    return oauthError(
      "invalid_client_metadata",
      "Send client_name and redirect_uris as JSON; only public clients (token_endpoint_auth_method none) are supported.",
    );
  }
  try {
    const client = mcpOAuth.register(
      input.client_name ?? "MCP client",
      input.redirect_uris,
    );
    return Response.json(
      {
        client_id: client.id,
        client_name: client.name,
        redirect_uris: client.redirectUris,
        token_endpoint_auth_method: "none",
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        client_id_issued_at: Math.floor(Date.now() / 1000),
      },
      { status: 201, headers: oauthHeaders },
    );
  } catch (error) {
    return oauthError(
      "invalid_redirect_uri",
      error instanceof Error ? error.message : "Registration failed.",
    );
  }
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
