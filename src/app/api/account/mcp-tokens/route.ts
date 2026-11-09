import { secureRoute, type Access } from "@/lib/access";
import { mcpTokens } from "@/lib/db";
import { body, failure } from "@/lib/http";
import { z } from "zod";

// Assistant tokens for the MCP endpoint, managed from a signed-in session
// only (a token cannot create or list tokens).
export const runtime = "nodejs";
const json = (value: unknown, status = 200) =>
  Response.json(value, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
async function GETHandler(_req: Request, _ctx: unknown, access: Access) {
  return json({ tokens: mcpTokens.list(access.workspace.id) });
}
async function POSTHandler(req: Request, _ctx: unknown, access: Access) {
  try {
    const { name } = z
      .object({ name: z.string().trim().min(1).max(60) })
      .strict()
      .parse(await body(req));
    const created = mcpTokens.create(access.workspace.id, access.user.id, name);
    return json(created, 201);
  } catch (error) {
    return failure(error);
  }
}
async function DELETEHandler(req: Request, _ctx: unknown, access: Access) {
  try {
    const { id } = z
      .object({ id: z.string().uuid() })
      .strict()
      .parse(await body(req));
    if (!mcpTokens.revoke(access.workspace.id, id))
      return json({ error: "Token not found." }, 404);
    return json({ tokens: mcpTokens.list(access.workspace.id) });
  } catch (error) {
    return failure(error);
  }
}
export const GET = secureRoute(GETHandler, "user");
export const POST = secureRoute(POSTHandler, "user");
export const DELETE = secureRoute(DELETEHandler, "user");
