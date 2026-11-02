import { ProviderError } from "./provider-error";
import { estimatedMicroUsd, type ProviderPrices } from "./provider-usage";

export const PROVIDER_OUTPUT_TOKENS = 6000;
export const PROVIDER_TIMEOUT_MS = 60_000;
export const PROVIDER_LEASE_MS = 90_000;
export const PROVIDER_BUDGET_WINDOW_MS = 86_400_000;
export type ProviderBudgetPolicy = {
  prices: ProviderPrices;
  globalMicroUsd: number;
  studioMicroUsd: number;
  globalConcurrency: number;
  studioConcurrency: number;
  payloadBytes: number;
  ledgerRequests: number;
};
export function providerBudgetPolicy(
  env: Record<string, string | undefined> = process.env,
): ProviderBudgetPolicy {
  function usd(name: string, fallback?: string) {
    const raw = env[name] || fallback;
    if (!raw || !/^(0|[1-9]\d{0,6})(?:\.\d{1,6})?$/.test(raw))
      throw new ProviderError("budget-configuration");
    const [whole, fraction = ""] = raw.split(".");
    const amount = Number(
      BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, "0")),
    );
    if (!Number.isSafeInteger(amount) || amount > 1_000_000_000_000)
      throw new ProviderError("budget-configuration");
    return amount;
  }
  function integer(
    name: string,
    fallback: number,
    minimum: number,
    max: number,
  ) {
    const raw = env[name];
    if (raw === undefined || raw === "") return fallback;
    if (!/^\d+$/.test(raw)) throw new ProviderError("budget-configuration");
    const value = Number(raw);
    if (!Number.isSafeInteger(value) || value < minimum || value > max)
      throw new ProviderError("budget-configuration");
    return value;
  }
  const input = usd("REELCHEMY_AI_INPUT_USD_PER_MILLION");
  const prices: ProviderPrices = {
    input,
    output: usd("REELCHEMY_AI_OUTPUT_USD_PER_MILLION"),
    cacheRead: usd(
      "REELCHEMY_AI_CACHE_READ_USD_PER_MILLION",
      String(input / 1_000_000),
    ),
    cacheWrite: usd(
      "REELCHEMY_AI_CACHE_WRITE_USD_PER_MILLION",
      String((input * 2) / 1_000_000),
    ),
  };
  if (prices.input === 0 || prices.output === 0)
    throw new ProviderError("budget-configuration");
  return {
    prices,
    globalMicroUsd: usd("REELCHEMY_AI_GLOBAL_USD_PER_DAY", "20"),
    studioMicroUsd: usd("REELCHEMY_AI_STUDIO_USD_PER_DAY", "2"),
    globalConcurrency: integer("REELCHEMY_AI_CONCURRENT_CALLS", 2, 1, 32),
    studioConcurrency: integer("REELCHEMY_AI_CALLS_PER_STUDIO", 1, 1, 4),
    payloadBytes: integer(
      "REELCHEMY_AI_MAX_PAYLOAD_BYTES",
      128 * 1024,
      16 * 1024,
      512 * 1024,
    ),
    ledgerRequests: integer(
      "REELCHEMY_AI_LEDGER_MAX_REQUESTS",
      100000,
      1,
      1000000,
    ),
  };
}
export function providerReservationCost(
  payloadBytes: number,
  policy: ProviderBudgetPolicy,
) {
  if (
    !Number.isSafeInteger(payloadBytes) ||
    payloadBytes < 0 ||
    payloadBytes > policy.payloadBytes
  )
    throw new ProviderError("request-size");
  // A conservative application estimate, not a tokenizer or a provider billing
  // guarantee. Include protocol headroom and the most expensive input category.
  const input = Math.max(
    policy.prices.input,
    policy.prices.cacheRead,
    policy.prices.cacheWrite,
  );
  return estimatedMicroUsd(
    {
      input: payloadBytes + 4096,
      output: PROVIDER_OUTPUT_TOKENS,
      cacheRead: 0,
      cacheWrite: 0,
    },
    { ...policy.prices, input },
  );
}
