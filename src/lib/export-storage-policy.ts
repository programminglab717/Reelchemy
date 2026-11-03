import { LimitConfigurationError } from "./limits-policy";
import { maximumExportReviewBytes } from "./export-file-policy";
export type ExportStoragePolicy = ReturnType<typeof exportStoragePolicy>;
export function exportStoragePolicy(
  env: Readonly<Record<string, string | undefined>> = process.env,
) {
  const value = (name: string, fallback: number, min: number, max: number) => {
    const raw = env[name];
    if (raw === undefined || raw === "") return fallback;
    if (!/^[1-9]\d*$/.test(raw)) throw new LimitConfigurationError();
    const result = Number(raw);
    if (!Number.isSafeInteger(result) || result < min || result > max)
      throw new LimitConfigurationError();
    return result;
  };
  const reservationBytes = value(
      "REELCHEMY_EXPORT_RESERVATION_BYTES",
      512 * 1024 ** 2,
      1024 ** 2,
      maximumExportReviewBytes,
    ),
    studioBytes = value(
      "REELCHEMY_EXPORT_STUDIO_BYTES",
      2 * 1024 ** 3,
      1024 ** 2,
      1024 ** 4,
    ),
    serviceBytes = value(
      "REELCHEMY_EXPORT_SERVICE_BYTES",
      8 * 1024 ** 3,
      1024 ** 2,
      4 * 1024 ** 4,
    ),
    studioExports = value("REELCHEMY_EXPORT_STUDIO_COUNT", 100, 1, 10000),
    serviceExports = value("REELCHEMY_EXPORT_SERVICE_COUNT", 2000, 1, 100000);
  if (
    reservationBytes > studioBytes ||
    studioBytes > serviceBytes ||
    studioExports > serviceExports
  )
    throw new LimitConfigurationError();
  return {
    reservationBytes,
    studioBytes,
    serviceBytes,
    studioExports,
    serviceExports,
  };
}
export type ExportStorageUsage = {
  usedBytes: number;
  reservedBytes: number;
  limitBytes: number;
  availableBytes: number;
  retainedExports: number;
  pendingExports: number;
  limitExports: number;
  outputCeilingBytes: number;
};
export class ExportStorageUnavailable extends Error {
  readonly code = "EXPORT_STORAGE_UNAVAILABLE";
  constructor() {
    super(
      "Export storage needs operator review before another export can start. Your saved film and existing downloads remain available.",
    );
  }
}
export class ExportStorageLimit extends Error {
  readonly code = "EXPORT_STORAGE_LIMIT";
  readonly retryAfter = 30;
  constructor(
    readonly scope: "studio" | "service",
    readonly kind: "bytes" | "exports",
  ) {
    super(
      scope === "service"
        ? "Export storage is temporarily full. Keep your film and retry after space is available."
        : "Your retained export allowance is full. Download files you need, then review removal of older export files before starting another export. Your saved film and original media are kept.",
    );
  }
}
export class ExportOutputLimit extends Error {
  readonly code = "EXPORT_OUTPUT_LIMIT";
  constructor() {
    super(
      "This export exceeded its file allowance. Try a shorter film or simpler media, then create a fresh export. Your saved film and original media are kept.",
    );
  }
}
