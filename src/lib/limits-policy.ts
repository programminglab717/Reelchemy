export type LimitedOperation = "writes" | "media" | "planning" | "render";
export class LimitConfigurationError extends Error {
  constructor() {
    super("Service limits need administrator attention.");
  }
}
export class RequestRateError extends Error {
  constructor(
    public retryAfter: number,
    operation: LimitedOperation,
  ) {
    const names = {
      writes: "studio changes",
      media: "media uploads or imports",
      planning: "planning requests",
      render: "export requests",
    };
    const amount =
      retryAfter >= 3600
        ? `${Math.ceil(retryAfter / 3600)} hours`
        : retryAfter >= 60
          ? `${Math.ceil(retryAfter / 60)} minutes`
          : `${retryAfter} seconds`;
    super(
      `The current limit for ${names[operation]} has been reached. Try again in ${amount}.`,
    );
  }
}
export function limitsPolicy(
  env: Record<string, string | undefined> = process.env,
) {
  function number(name: string, fallback: number, max: number) {
    const raw = env[name];
    if (raw === undefined || raw === "") return fallback;
    if (!/^\d+$/.test(raw)) throw new LimitConfigurationError();
    const value = Number(raw);
    if (!Number.isSafeInteger(value) || value < 1 || value > max)
      throw new LimitConfigurationError();
    return value;
  }
  return {
    writes: {
      count: number("REELCHEMY_WRITES_PER_MINUTE", 120, 10000),
      windowMs: 60000,
    },
    media: {
      count: number("REELCHEMY_MEDIA_REQUESTS_PER_HOUR", 30, 1000),
      windowMs: 3600000,
    },
    planning: {
      count: number("REELCHEMY_PLANS_PER_DAY", 60, 10000),
      windowMs: 86400000,
    },
    render: {
      count: number("REELCHEMY_EXPORT_REQUESTS_PER_DAY", 30, 10000),
      windowMs: 86400000,
    },
  };
}
