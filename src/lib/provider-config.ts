import { ProviderError } from "./provider-error";

export function providerConfiguration(
  env: Record<string, string | undefined> = process.env,
) {
  const provider = env.AI_PROVIDER || "mock";
  if (provider === "mock") return { provider } as const;
  if (provider !== "compatible" && provider !== "anthropic")
    throw new ProviderError("configuration");
  const key = env.AI_API_KEY;
  const model = env.AI_MODEL;
  const base =
    env.AI_BASE_URL ||
    (provider === "anthropic" ? "https://api.anthropic.com/v1" : undefined);
  if (
    !key ||
    key.length > 4096 ||
    !/^[\x21-\x7e]+$/.test(key) ||
    !model ||
    model.length > 200 ||
    !/^[\x21-\x7e]+$/.test(model) ||
    !base ||
    base.length > 2048 ||
    base.trim() !== base ||
    /[\x00-\x20\x7f]/.test(base)
  )
    throw new ProviderError("configuration");
  let url: URL;
  try {
    url = new URL(base);
  } catch {
    throw new ProviderError("configuration");
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new ProviderError("configuration");
  url.pathname = `${url.pathname.replace(/\/+$/, "")}/${provider === "anthropic" ? "messages" : "chat/completions"}`;
  return { provider, key, model, endpoint: url.toString() } as const;
}
