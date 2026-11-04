import { LimitConfigurationError } from "./limits-policy";

// Match the portable snapshot's bounded full-job document reader. A native
// report and its immutable timeline receive capacity before any render starts.
export const maximumJobDocumentBytes = 4 * 1024 ** 2;
export const maximumJobTimelineBytes = 4 * 1024 ** 2;
export const jobDocumentReservationBytes =
  maximumJobDocumentBytes + maximumJobTimelineBytes + 4096;
export const maximumIndexedJobs = 100000;
export type JobHistoryPolicy = ReturnType<typeof jobHistoryPolicy>;
export function jobHistoryPolicy(
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
  const studioBytes = value(
      "REELCHEMY_JOB_STUDIO_BYTES",
      256 * 1024 ** 2,
      jobDocumentReservationBytes,
      16 * 1024 ** 3,
    ),
    serviceBytes = value(
      "REELCHEMY_JOB_SERVICE_BYTES",
      4 * 1024 ** 3,
      jobDocumentReservationBytes,
      1024 ** 4,
    ),
    studioJobs = value("REELCHEMY_JOB_STUDIO_COUNT", 500, 1, 10000),
    serviceJobs = value(
      "REELCHEMY_JOB_SERVICE_COUNT",
      20000,
      1,
      maximumIndexedJobs - 1,
    ),
    studioRetired = value(
      "REELCHEMY_JOB_STUDIO_RETIRED",
      5000,
      1,
      maximumIndexedJobs - 1,
    ),
    serviceRetired = value(
      "REELCHEMY_JOB_SERVICE_RETIRED",
      80000,
      1,
      maximumIndexedJobs - 1,
    );
  if (
    studioBytes > serviceBytes ||
    studioJobs > serviceJobs ||
    studioRetired > serviceRetired ||
    serviceJobs + serviceRetired > maximumIndexedJobs
  )
    throw new LimitConfigurationError();
  return {
    studioBytes,
    serviceBytes,
    studioJobs,
    serviceJobs,
    studioRetired,
    serviceRetired,
  };
}
export type JobHistoryUsage = {
  bytes: number;
  reservedBytes: number;
  fullJobs: number;
  retiredJobs: number;
  pendingJobs: number;
  limitBytes: number;
  limitJobs: number;
  limitRetired: number;
  reservationBytes: number;
};
export class JobHistoryUnavailable extends Error {
  readonly code = "JOB_HISTORY_UNAVAILABLE";
  constructor() {
    super(
      "Export activity needs operator review before more details can be stored. Your saved film and original media are kept.",
    );
  }
}
export class JobHistoryLimit extends Error {
  readonly code = "JOB_HISTORY_LIMIT";
  constructor(
    readonly scope: "studio" | "service",
    readonly kind: "bytes" | "jobs" | "retired",
  ) {
    super(
      scope === "service"
        ? "Export activity storage is temporarily full. Keep your film and retry after the operator has made capacity available."
        : kind === "retired"
          ? "Your retained activity-record allowance is full. Contact the studio operator before retiring more details. Your saved films and original media are kept."
          : "Your export activity allowance is full. Review older export details to make room before exporting again. Your saved films and original media are kept.",
    );
  }
}
export class JobHistoryConflict extends Error {
  readonly code = "JOB_HISTORY_CONFLICT";
  constructor() {
    super(
      "This export changed after your review. Review its current details before confirming again.",
    );
  }
}
export class JobHistoryBusy extends Error {
  constructor() {
    super(
      "Finish removing this export's files and wait for rendering or cancellation to stop before retiring its details.",
    );
  }
}
