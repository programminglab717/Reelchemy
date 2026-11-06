import { secureRoute, type Access } from "@/lib/access";
import {
  studioAiCredentials,
  studioAiEntitlements,
  studioAiUsage,
} from "@/lib/db";
import { authSigningSecret } from "@/lib/auth";
import { providerConfiguration } from "@/lib/provider-config";
import { platformAiMode } from "@/lib/studio-ai-access";
import { failure, body, localMutation } from "@/lib/http";
const headers = {
  "Cache-Control": "private, no-store",
  "X-Content-Type-Options": "nosniff",
};
// The saved key itself is never returned; only provider/model/prices, the
// last four characters and today's usage for the source in effect.
function state(workspaceId: string) {
  const own = studioAiCredentials.summary(workspaceId) ?? null;
  let platform = false;
  try {
    const mode = platformAiMode();
    platform =
      providerConfiguration().provider !== "mock" &&
      mode !== "off" &&
      (mode === "all" || !!studioAiEntitlements.get(workspaceId));
  } catch {
    platform = false;
  }
  const access = own ? "own" : platform ? "platform" : "demo";
  return {
    access,
    own,
    platformAvailable: platform,
    usage:
      access === "demo"
        ? null
        : studioAiUsage(workspaceId, access === "own" ? "own" : "platform"),
  };
}
function GETHandler(_request: Request, _context: unknown, access: Access) {
  try {
    return Response.json(state(access.workspace.id), { headers });
  } catch (error) {
    return failure(error);
  }
}
async function PUTHandler(request: Request, _context: unknown, access: Access) {
  try {
    localMutation(request);
    studioAiCredentials.save(
      access.workspace.id,
      (await body(request)) as Parameters<typeof studioAiCredentials.save>[1],
      authSigningSecret(),
    );
    return Response.json(state(access.workspace.id), { headers });
  } catch (error) {
    return failure(error);
  }
}
function DELETEHandler(request: Request, _context: unknown, access: Access) {
  try {
    localMutation(request);
    studioAiCredentials.remove(access.workspace.id);
    return Response.json(state(access.workspace.id), { headers });
  } catch (error) {
    return failure(error);
  }
}
export const GET = secureRoute(GETHandler, "user");
export const PUT = secureRoute(PUTHandler, "user");
export const DELETE = secureRoute(DELETEHandler, "user");
