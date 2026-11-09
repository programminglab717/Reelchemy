import { protectedResourceMetadata } from "@/lib/mcp-oauth-http";

// RFC 9728: how MCP clients find where to sign in for /api/mcp.
export const dynamic = "force-dynamic";
export const GET = (request: Request) => protectedResourceMetadata(request);
