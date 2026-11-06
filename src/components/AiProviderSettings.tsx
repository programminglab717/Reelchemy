"use client";
import { useCallback, useEffect, useState } from "react";
import { useAccountFetch } from "./AccountBoundary";

type Usage = {
  requests: number;
  chargedMicroUsd: number;
  heldMicroUsd: number;
  inputTokens: number;
  outputTokens: number;
};
type State = {
  access: "own" | "platform" | "demo";
  own: {
    provider: "anthropic" | "compatible";
    model: string;
    baseUrl: string;
    keyHint: string;
    inputUsdPerMillion: string;
    outputUsdPerMillion: string;
    dailyUsd: string;
    updatedAt: string;
  } | null;
  platformAvailable: boolean;
  usage: Usage | null;
};
// Presets only fill the form; the saved provider is Anthropic's Messages API
// or an OpenAI-compatible chat-completions endpoint (OpenAI, Google Gemini's
// OpenAI-compatible endpoint, or another HTTPS provider).
const presets = {
  anthropic: {
    provider: "anthropic",
    baseUrl: "",
    label: "Anthropic (Claude)",
  },
  openai: {
    provider: "compatible",
    baseUrl: "https://api.openai.com/v1",
    label: "OpenAI",
  },
  gemini: {
    provider: "compatible",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    label: "Google Gemini",
  },
  custom: {
    provider: "compatible",
    baseUrl: "",
    label: "Other OpenAI-compatible",
  },
} as const;
type Preset = keyof typeof presets;
const dollars = (micro: number) =>
  `$${(micro / 1_000_000).toFixed(micro && micro < 10_000 ? 4 : 2)}`;
function presetFor(own: State["own"]): Preset {
  if (!own || own.provider === "anthropic") return "anthropic";
  if (own.baseUrl === presets.openai.baseUrl) return "openai";
  if (own.baseUrl === presets.gemini.baseUrl) return "gemini";
  return "custom";
}
export function AiProviderSettings() {
  const request = useAccountFetch();
  const [state, setState] = useState<State | null>(null),
    [preset, setPreset] = useState<Preset>("anthropic"),
    [editing, setEditing] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const call = useCallback(
    async (method: "GET" | "PUT" | "DELETE", body?: unknown) => {
      const response = await request("/api/workspace/ai-provider", {
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
            : "AI provider settings are unavailable. Try again shortly.",
        );
      return value as State;
    },
    [request],
  );
  useEffect(() => {
    let live = true;
    call("GET")
      .then((value) => {
        if (!live) return;
        setState(value);
        setPreset(presetFor(value.own));
      })
      .catch((reason: Error) => live && setError(reason.message));
    return () => {
      live = false;
    };
  }, [call]);
  const own = state?.own;
  return (
    <section
      className="ai-provider-settings"
      aria-labelledby="ai-provider-title"
    >
      <h2 id="ai-provider-title">AI director</h2>
      {!state ? (
        <p role="status">{error || "Loading AI settings…"}</p>
      ) : (
        <>
          <p role="status" aria-label="AI director source">
            {state.access === "own"
              ? `Using your own ${own?.provider === "anthropic" ? "Anthropic" : presets[presetFor(own ?? null)].label} key ending in ${own?.keyHint} (${own?.model}).`
              : state.access === "platform"
                ? "Using the studio's provided AI director."
                : "Using the demo director. Add your own AI provider key to plan storyboards with a real model."}
          </p>
          {state.usage && (
            <p aria-label="AI usage today">
              Last 24 hours: {state.usage.requests} request
              {state.usage.requests === 1 ? "" : "s"},{" "}
              {state.usage.inputTokens.toLocaleString()} input /{" "}
              {state.usage.outputTokens.toLocaleString()} output tokens, about{" "}
              {dollars(state.usage.chargedMicroUsd)}
              {state.access === "own" && own
                ? ` of your $${own.dailyUsd} daily limit`
                : ""}
              . Estimates use your saved prices; your provider&apos;s bill is
              authoritative.
            </p>
          )}
          {own && !editing ? (
            <div className="ai-provider-actions">
              <button type="button" onClick={() => setEditing(true)}>
                Replace key or settings
              </button>
              <button
                type="button"
                className="danger"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  setError("");
                  try {
                    setState(await call("DELETE"));
                    setNotice("Your AI provider key was deleted.");
                  } catch (reason) {
                    setError((reason as Error).message);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Delete my AI key
              </button>
            </div>
          ) : !own && !editing ? (
            <button type="button" onClick={() => setEditing(true)}>
              Add my AI provider key
            </button>
          ) : (
            <form
              aria-label="AI provider key"
              onSubmit={async (event) => {
                event.preventDefault();
                if (busy) return;
                const form = event.currentTarget,
                  data = new FormData(form);
                setBusy(true);
                setError("");
                setNotice("");
                try {
                  const next = await call("PUT", {
                    provider: presets[preset].provider,
                    baseUrl: String(data.get("baseUrl") || ""),
                    model: String(data.get("model") || ""),
                    apiKey: String(data.get("apiKey") || ""),
                    inputUsdPerMillion: String(data.get("inputUsd") || ""),
                    outputUsdPerMillion: String(data.get("outputUsd") || ""),
                    dailyUsd: String(data.get("dailyUsd") || ""),
                  });
                  const key = form.elements.namedItem("apiKey");
                  if (key instanceof HTMLInputElement) key.value = "";
                  setState(next);
                  setEditing(false);
                  setNotice("Your AI provider key was saved and encrypted.");
                } catch (reason) {
                  setError((reason as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              <label>
                Provider
                <select
                  value={preset}
                  onChange={(event) => setPreset(event.target.value as Preset)}
                >
                  {(Object.keys(presets) as Preset[]).map((name) => (
                    <option key={name} value={name}>
                      {presets[name].label}
                    </option>
                  ))}
                </select>
              </label>
              {preset !== "anthropic" && (
                <label>
                  API base URL
                  <input
                    name="baseUrl"
                    key={preset}
                    type="url"
                    required
                    defaultValue={
                      preset === presetFor(own ?? null) && own?.baseUrl
                        ? own.baseUrl
                        : presets[preset].baseUrl
                    }
                    readOnly={preset !== "custom"}
                    maxLength={2048}
                  />
                </label>
              )}
              <label>
                Model
                <input
                  name="model"
                  required
                  maxLength={200}
                  defaultValue={own?.model ?? ""}
                  placeholder={
                    preset === "anthropic"
                      ? "e.g. a Claude model ID from your console"
                      : preset === "gemini"
                        ? "e.g. a Gemini model ID"
                        : "Model ID from your provider"
                  }
                  autoComplete="off"
                />
              </label>
              <label>
                API key
                <input
                  name="apiKey"
                  type="password"
                  required
                  maxLength={4096}
                  autoComplete="off"
                  placeholder={
                    own ? `Replaces the key ending in ${own.keyHint}` : ""
                  }
                />
              </label>
              <fieldset>
                <legend>Model prices and your daily limit (US dollars)</legend>
                <label>
                  Input per million tokens
                  <input
                    name="inputUsd"
                    inputMode="decimal"
                    required
                    pattern="(0|[1-9][0-9]{0,6})(\.[0-9]{1,6})?"
                    defaultValue={own?.inputUsdPerMillion ?? ""}
                  />
                </label>
                <label>
                  Output per million tokens
                  <input
                    name="outputUsd"
                    inputMode="decimal"
                    required
                    pattern="(0|[1-9][0-9]{0,6})(\.[0-9]{1,6})?"
                    defaultValue={own?.outputUsdPerMillion ?? ""}
                  />
                </label>
                <label>
                  Daily spending limit
                  <input
                    name="dailyUsd"
                    inputMode="decimal"
                    required
                    pattern="(0|[1-9][0-9]{0,6})(\.[0-9]{1,6})?"
                    defaultValue={own?.dailyUsd ?? "5"}
                  />
                </label>
                <small>
                  Copy prices from your provider&apos;s pricing page. They are
                  used to estimate usage and stop requests once your daily limit
                  is reached.
                </small>
              </fieldset>
              <p className="ai-key-privacy">
                Your key is encrypted on the server, used only for your
                studio&apos;s AI requests, never shown again in full, and you
                can delete it at any time.
              </p>
              <div className="ai-provider-actions">
                <button type="submit" className="primary" disabled={busy}>
                  {busy ? "Saving…" : "Save encrypted key"}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    setEditing(false);
                    setError("");
                  }}
                >
                  Cancel
                </button>
              </div>
            </form>
          )}
          {notice && <p role="status">{notice}</p>}
          {error && <p role="alert">{error}</p>}
        </>
      )}
    </section>
  );
}
