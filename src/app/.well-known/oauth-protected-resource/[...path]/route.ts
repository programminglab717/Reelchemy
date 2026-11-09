import { protectedResourceMetadata } from "@/lib/mcp-oauth-http";

// The same metadata at the resource-specific path (/.well-known/oauth-protected-resource/api/mcp).
export const dynamic = "force-dynamic";
export const GET = (request: Request) => protectedResourceMetadata(request);
