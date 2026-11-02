export type ProviderTokens = {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
};
export type ProviderPrices = {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
};
const MAX_TOKENS = 100_000_000;
function object(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
function count(value: unknown, optional = false): number | undefined {
  if (value === undefined && optional) return 0;
  return typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 0 &&
    value <= MAX_TOKENS
    ? value
    : undefined;
}
// Missing/malformed usage is uncertainty, never a free request. Token counts
// are provider reports; configured-price estimates are not provider invoices.
export function providerTokens(
  provider: "anthropic" | "compatible",
  response: unknown,
): ProviderTokens | undefined {
  const usage = object(object(response)?.usage);
  if (!usage) return undefined;
  let input: number | undefined,
    output: number | undefined,
    cacheRead: number | undefined,
    cacheWrite: number | undefined;
  if (provider === "anthropic") {
    input = count(usage.input_tokens);
    output = count(usage.output_tokens);
    cacheRead = count(usage.cache_read_input_tokens, true);
    cacheWrite = count(usage.cache_creation_input_tokens, true);
    if (usage.cache_creation !== undefined) {
      const creation = object(usage.cache_creation);
      if (!creation) return undefined;
      const short = count(creation.ephemeral_5m_input_tokens, true),
        long = count(creation.ephemeral_1h_input_tokens, true);
      if (
        short === undefined ||
        long === undefined ||
        short + long !== cacheWrite
      )
        return undefined;
    }
  } else {
    const details = object(usage.prompt_tokens_details);
    if (usage.prompt_tokens_details !== undefined && !details) return undefined;
    input = count(usage.prompt_tokens);
    output = count(usage.completion_tokens);
    cacheRead = count(details?.cached_tokens, true);
    cacheWrite = 0;
    if (input !== undefined && cacheRead !== undefined) {
      if (cacheRead > input) return undefined;
      input -= cacheRead;
    }
    const total = count(usage.total_tokens, true);
    if (
      usage.total_tokens !== undefined &&
      (total === undefined ||
        total !== (input ?? NaN) + (cacheRead ?? NaN) + (output ?? NaN))
    )
      return undefined;
  }
  if (
    input === undefined ||
    output === undefined ||
    cacheRead === undefined ||
    cacheWrite === undefined ||
    input + cacheRead + cacheWrite > MAX_TOKENS
  )
    return undefined;
  return { input, output, cacheRead, cacheWrite };
}
export function estimatedMicroUsd(
  tokens: ProviderTokens,
  prices: ProviderPrices,
) {
  let numerator = 0n;
  for (const name of ["input", "output", "cacheRead", "cacheWrite"] as const) {
    const quantity = tokens[name],
      price = prices[name];
    if (
      !Number.isSafeInteger(quantity) ||
      quantity < 0 ||
      !Number.isSafeInteger(price) ||
      price < 0
    )
      throw new Error("Invalid usage estimate.");
    numerator += BigInt(quantity) * BigInt(price);
  }
  // Prices are integer micro-USD per million tokens. Round up once per call.
  const amount = Number((numerator + 999_999n) / 1_000_000n);
  if (!Number.isSafeInteger(amount)) throw new Error("Invalid usage estimate.");
  return amount;
}
