import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getAuth } from "@/lib/auth";
import { mcpOAuth } from "@/lib/db";

// Consent for an AI app (claude.ai, ChatGPT or another MCP client) to make
// videos in this studio. Shown to the signed-in owner; the answer is posted
// to /api/oauth/authorize.
export const dynamic = "force-dynamic";
type Search = Record<string, string | string[] | undefined>;
const one = (value: string | string[] | undefined) =>
  typeof value === "string" ? value : "";
export default async function Authorize({
  searchParams,
}: {
  searchParams: Promise<Search>;
}) {
  const query = await searchParams;
  const clientId = one(query.client_id),
    redirectUri = one(query.redirect_uri),
    challenge = one(query.code_challenge),
    state = one(query.state);
  const client = mcpOAuth.client(clientId);
  const valid =
    !!client &&
    one(query.response_type) === "code" &&
    one(query.code_challenge_method) === "S256" &&
    /^[A-Za-z0-9_-]{43}$/.test(challenge) &&
    client.redirectUris.includes(redirectUri);
  if (!valid)
    return (
      <main className="account-page">
        <section className="account-card oauth-consent">
          <h1>This connection request is not valid</h1>
          <p>
            Start connecting again from your AI app. It must use a registered
            redirect address and PKCE (S256).
          </p>
        </section>
      </main>
    );
  let session;
  try {
    session = await (
      await getAuth()
    ).api.getSession({ headers: await headers() });
  } catch {
    session = null;
  }
  if (!session?.user.emailVerified) {
    const back = `/oauth/authorize?${new URLSearchParams(
      Object.entries(query).flatMap(([k, v]) =>
        typeof v === "string" ? [[k, v]] : [],
      ),
    )}`;
    redirect(`/sign-in?next=${encodeURIComponent(back)}`);
  }
  const host = new URL(redirectUri).host;
  return (
    <main className="account-page">
      <section
        className="account-card oauth-consent"
        aria-labelledby="consent-title"
      >
        <span className="eyebrow">CONNECT AN AI APP</span>
        <h1 id="consent-title">
          Allow {client.name} to make videos in your studio?
        </h1>
        <p>
          Signed in as <strong>{session.user.email}</strong>. {client.name}{" "}
          (returning to <code>{host}</code>) will be able to:
        </p>
        <ul>
          <li>read your projects and their uploaded images,</li>
          <li>create projects and write or change their scenes,</li>
          <li>preview scenes, start the AI director and start exports.</li>
        </ul>
        <p>
          It cannot change your account, keys or other settings. Disconnect it
          any time in Account settings → AI assistants.
        </p>
        <form
          method="post"
          action="/api/oauth/authorize"
          className="oauth-actions"
        >
          <input type="hidden" name="client_id" value={clientId} />
          <input type="hidden" name="redirect_uri" value={redirectUri} />
          <input type="hidden" name="code_challenge" value={challenge} />
          <input type="hidden" name="state" value={state} />
          <button type="submit" name="decision" value="deny" className="subtle">
            Deny
          </button>
          <button
            type="submit"
            name="decision"
            value="allow"
            className="primary"
          >
            Allow
          </button>
        </form>
      </section>
    </main>
  );
}
