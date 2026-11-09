// Shared HTTP pieces of the MCP OAuth endpoints.
export function studioOrigin(request: Request) {
  try {
    if (process.env.BETTER_AUTH_URL)
      return new URL(process.env.BETTER_AUTH_URL).origin;
  } catch {}
  return new URL(request.url).origin;
}
export const oauthHeaders = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  // Metadata is fetched by browsers during connector setup.
  "Access-Control-Allow-Origin": "*",
};
export const oauthError = (error: string, description: string, status = 400) =>
  Response.json(
    { error, error_description: description },
    { status, headers: oauthHeaders },
  );
export function protectedResourceMetadata(request: Request) {
  const origin = studioOrigin(request);
  return Response.json(
    {
      resource: `${origin}/api/mcp`,
      authorization_servers: [origin],
      scopes_supported: ["studio"],
      bearer_methods_supported: ["header"],
      resource_name: "Reelchemy studio",
    },
    { headers: oauthHeaders },
  );
}
