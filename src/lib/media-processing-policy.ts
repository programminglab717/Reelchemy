import { LimitConfigurationError } from "./limits-policy";

import { MAX_MEDIA_UPLOAD_BYTES, MAX_ARCHIVE_BYTES } from "./timeline-limits";

// Largest queued input per operation (a staged chunked upload may reach it).
export const MEDIA_INPUT_BYTES = {
  upload: Math.max(...Object.values(MAX_MEDIA_UPLOAD_BYTES)),
  import: MAX_ARCHIVE_BYTES,
  waveform: 0,
} as const;
// Largest body accepted in one request. The studio sends anything above one
// upload chunk in pieces; this keeps older clients' single uploads working.
export const MEDIA_DIRECT_BYTES = {
  upload: 96 * 1024 * 1024,
  import: MEDIA_INPUT_BYTES.import,
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
    analysesPerHour: integer("REELCHEMY_WAVEFORMS_PER_HOUR", 120, 1, 1000),
    // Disk for raw inputs waiting to be processed, and separately for chunked
    // uploads still arriving. Each request reserves its actual size (a direct
    // upload reserves its single-request maximum).
    rawBytes: integer(
      "REELCHEMY_MEDIA_RAW_BYTES",
      4 * 1024 ** 3,
      // At least one project import.
      MEDIA_INPUT_BYTES.import,
      64 * 1024 ** 3,
    ),
    // Unfinished chunked uploads can resume for this long after their last piece.
    stagingIdleMs: 6 * 3600000,
    stagingPerStudio: 2,
    // Large uploads over ordinary connections (and tunnels) need minutes.
    receiveMs: 600000,
    receiveCleanupMs: 720000,
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
export class MediaAnalysisLimit extends Error {
  readonly code = "MEDIA_ANALYSIS_LIMIT";
  constructor(readonly retryAfter: number) {
    super(
      "Your studio's waveform preparation allowance has been reached. Existing waveforms remain available. Try again later.",
    );
  }
}
