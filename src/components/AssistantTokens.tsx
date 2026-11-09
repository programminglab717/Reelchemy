"use client";
import { useCallback, useEffect, useState } from "react";
import { useAccountFetch } from "./AccountBoundary";

type Token = {
  id: string;
  name: string;
  hint: string;
  createdAt: string;
  lastUsedAt: string | null;
  kind: "token" | "app";
};
const when = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      })
    : "never";

// Personal access tokens for AI assistants (Claude, ChatGPT and other MCP
// clients) that make videos in this studio through its MCP endpoint.
export function AssistantTokens() {
  const request = useAccountFetch();
  const [tokens, setTokens] = useState<Token[] | null>(null),
    [name, setName] = useState("Claude"),
    [created, setCreated] = useState<string | null>(null),
    [copied, setCopied] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const endpoint =
    typeof window === "undefined"
      ? "/api/mcp"
      : `${window.location.origin}/api/mcp`;
  const call = useCallback(
    async (method: "GET" | "POST" | "DELETE", body?: unknown) => {
      const response = await request("/api/account/mcp-tokens", {
        method,
        ...(body
          ? {
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(body),
            }
          : {}),
        signal: AbortSignal.timeout(20000),
      });
      const value = await response.json().catch(() => null);
      if (!response.ok)
        throw new Error(
          typeof value?.error === "string"
            ? value.error
            : "Assistant tokens are unavailable. Try again shortly.",
        );
      return value;
    },
    [request],
  );
  useEffect(() => {
    let live = true;
    call("GET")
      .then((value) => live && setTokens(value.tokens))
      .catch((reason: Error) => live && setError(reason.message));
    return () => {
      live = false;
    };
  }, [call]);
  const run = async (task: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await task();
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const copy = async (label: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(label);
    } catch {
      setCopied("");
    }
  };
  const claudeCode = `claude mcp add --transport http reelchemy ${endpoint} --header "Authorization: Bearer ${created ?? "YOUR_TOKEN"}"`;
  return (
    <section
      className="assistant-tokens"
      aria-labelledby="assistant-tokens-title"
    >
      <h2 id="assistant-tokens-title">AI assistants (MCP)</h2>
      <p>
        Let Claude, ChatGPT or another MCP client make videos in this studio: it
        reads the motion guide, writes code scenes, checks their stills and
        exports. A token acts only for your studio and can be revoked at any
        time.
      </p>
      <dl className="assistant-endpoint">
        <dt>Server URL</dt>
        <dd>
          <code>{endpoint}</code>{" "}
          <button
            type="button"
            className="subtle"
            onClick={() => void copy("url", endpoint)}
          >
            {copied === "url" ? "Copied" : "Copy"}
          </button>
        </dd>
      </dl>
      {created && (
        <div
          className="assistant-new-token"
          role="status"
          aria-label="New assistant token"
        >
          <p>
            <strong>Copy your token now.</strong> It is shown only once.
          </p>
          <code className="assistant-secret">{created}</code>
          <div className="assistant-actions">
            <button type="button" onClick={() => void copy("token", created)}>
              {copied === "token" ? "Copied" : "Copy token"}
            </button>
            <button
              type="button"
              className="subtle"
              onClick={() => void copy("claude", claudeCode)}
            >
              {copied === "claude" ? "Copied" : "Copy Claude Code command"}
            </button>
            <button
              type="button"
              className="subtle"
              onClick={() => setCreated(null)}
            >
              Done
            </button>
          </div>
        </div>
      )}
      <form
        className="assistant-create"
        onSubmit={(event) => {
          event.preventDefault();
          void run(async () => {
            const value = await call("POST", { name });
            setCreated(value.token);
            setCopied("");
            setTokens(await call("GET").then((v) => v.tokens));
          });
        }}
      >
        <label>
          Token name
          <input
            value={name}
            maxLength={60}
            onChange={(event) => setName(event.target.value)}
            aria-label="Assistant token name"
          />
        </label>
        <button type="submit" disabled={busy || !name.trim()}>
          Create token
        </button>
      </form>
      {error && <p role="alert">{error}</p>}
      {tokens === null ? (
        !error && <p role="status">Loading tokens…</p>
      ) : tokens.length ? (
        <ul className="assistant-list" aria-label="Assistant tokens">
          {tokens.map((token) => (
            <li key={token.id}>
              <span>
                <strong>{token.name}</strong>{" "}
                {token.kind === "app" ? "· connected app" : `· …${token.hint}`}
                <small>
                  {token.kind === "app" ? "Connected" : "Created"}{" "}
                  {when(token.createdAt)} · last used {when(token.lastUsedAt)}
                </small>
              </span>
              <button
                type="button"
                className="subtle"
                disabled={busy}
                aria-label={`${token.kind === "app" ? "Disconnect" : "Revoke"} ${token.name}`}
                onClick={() =>
                  void run(async () =>
                    setTokens((await call("DELETE", { id: token.id })).tokens),
                  )
                }
              >
                {token.kind === "app" ? "Disconnect" : "Revoke"}
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p>No assistant tokens yet.</p>
      )}
      <details className="assistant-help">
        <summary>How to connect</summary>
        <ul>
          <li>
            <strong>Claude Code:</strong> run <code>{claudeCode}</code>
          </li>
          <li>
            <strong>claude.ai, ChatGPT and other apps with connectors:</strong>{" "}
            add a custom connector with the server URL above. The app asks you
            to sign in here and approve it; no token is needed.
          </li>
          <li>
            <strong>Claude Desktop, Cursor and other clients:</strong> add a
            remote (Streamable HTTP) MCP server with the server URL above and
            the header <code>Authorization: Bearer &lt;token&gt;</code>.
          </li>
          <li>
            Then ask, for example: &ldquo;Make a 30-second explainer about how
            DNS works in Reelchemy.&rdquo; The assistant previews each scene and
            fixes what the checks report before exporting.
          </li>
        </ul>
      </details>
    </section>
  );
}
