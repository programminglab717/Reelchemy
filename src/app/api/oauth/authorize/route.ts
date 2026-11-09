import { secureRoute, type Access } from "@/lib/access";
import { mcpOAuth } from "@/lib/db";
import { readLimitedBody } from "@/lib/http";

// The owner's answer on the consent page (a same-site form post from a
// signed-in session): redirect back to the app with a code, or a denial.
export const runtime = "nodejs";
async function POSTHandler(req: Request, _ctx: unknown, access: Access) {
  const form = new URLSearchParams(
    new TextDecoder().decode(await readLimitedBody(req, 16384)),
  );
  const client = mcpOAuth.client(form.get("client_id") ?? "");
  const redirectUri = form.get("redirect_uri") ?? "";
  const challenge = form.get("code_challenge") ?? "";
  if (
    !client ||
    !client.redirectUris.includes(redirectUri) ||
    !/^[A-Za-z0-9_-]{43}$/.test(challenge)
  )
    return Response.json(
      { error: "This connection request is not valid." },
      { status: 400 },
    );
  const target = new URL(redirectUri);
  const state = form.get("state");
  if (state) target.searchParams.set("state", state);
  if (form.get("decision") !== "allow")
    target.searchParams.set("error", "access_denied");
  else
    target.searchParams.set(
      "code",
      mcpOAuth.issueCode({
        clientId: client.id,
        workspaceId: access.workspace.id,
        userId: access.user.id,
        redirectUri,
        challenge,
      }),
    );
  return new Response(null, {
    status: 303,
    headers: { Location: target.toString(), "Cache-Control": "no-store" },
  });
}
export const POST = secureRoute(POSTHandler, "user");
