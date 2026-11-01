import { LimitConfigurationError } from "./limits-policy";

export const MEDIA_INPUT_BYTES = {
  upload: 26 * 1024 * 1024,
  import: 50 * 1024 * 1024,
  waveform: 0,
} as const;
export type MediaOperation = keyof typeof MEDIA_INPUT_BYTES;
export type MediaProcessingPolicy = ReturnType<typeof mediaProcessingPolicy>;

// These bound admission, including requests still receiving bytes. They do not
// increase codec limits or the existing per-studio hourly request allowance.
export function mediaProcessingPolicy(
  env: Record<string, string | undefined> = process.env,
) {
  function integer(name: string, fallback: number, min: number, max: number) {
    const raw = env[name];
    if (raw === undefined || raw === "") return fallback;
    const value = Number(raw);
    if (
      !/^\d+$/.test(raw) ||
      !Number.isSafeInteger(value) ||
      value < min ||
      value > max
    )
      throw new LimitConfigurationError();
    return value;
  }
  const inputs = integer("REELCHEMY_MEDIA_INPUT_SLOTS", 4, 1, 16);
  const perStudioInputs = integer(
    "REELCHEMY_MEDIA_INPUTS_PER_STUDIO",
    1,
    1,
    inputs,
  );
  const analyses = integer("REELCHEMY_MEDIA_ANALYSIS_SLOTS", 16, 1, 64);
  const perStudioAnalyses = integer(
    "REELCHEMY_MEDIA_ANALYSES_PER_STUDIO",
    4,
    1,
    analyses,
  );
  return {
    inputs,
    perStudioInputs,
    analyses,
    perStudioAnalyses,
    rawBytes: integer(
      "REELCHEMY_MEDIA_RAW_BYTES",
      256 * 1024 * 1024,
      50 * 1024 * 1024,
      1024 ** 3,
    ),
    receiveMs: 90000,
    receiveCleanupMs: 180000,
    processingMs: 600000,
    retryAfter: 5,
    receiptMs: 7 * 86400000,
  };
}

export class MediaProcessingCapacity extends Error {
  readonly code = "MEDIA_PROCESSING_CAPACITY";
  constructor(
    readonly scope: "studio" | "global",
    readonly retryAfter = 5,
  ) {
    super(
      scope === "studio"
        ? "Your studio already has media processing in progress. Wait for it to finish and try again."
        : "Media processing is busy. Keep your file and try again shortly.",
    );
  }
}
export class MediaProcessingConflict extends Error {
  readonly code = "MEDIA_PROCESSING_CONFLICT";
  constructor() {
    super(
      "This media request has already been used for a different operation.",
    );
  }
}
export class MediaProcessingUnavailable extends Error {
  readonly code = "MEDIA_PROCESSING_UNAVAILABLE";
  constructor() {
    super(
      "This media request is no longer available. Refresh its status before retrying.",
    );
  }
}
