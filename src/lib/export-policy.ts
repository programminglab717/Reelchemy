import { LimitConfigurationError } from "./limits-policy";
export function activeExportLimit(
  env: Record<string, string | undefined> = process.env,
) {
  const raw = env.REELCHEMY_ACTIVE_EXPORTS_PER_STUDIO;
  if (raw === undefined || raw === "") return 2;
  if (!/^[1-5]$/.test(raw)) throw new LimitConfigurationError();
  return Number(raw);
}
export class ExportCapacityError extends Error {
  readonly retryAfter = 30;
  constructor(public scope: "studio" | "global") {
    super(
      scope === "studio"
        ? "Your studio's export queue is full. Wait for an export to finish or cancel one in Studio exports."
        : "The render queue is full. Wait for an export to finish and try again.",
    );
  }
}
export class ExportRequestConflict extends Error {
  constructor() {
    super(
      "This export request was already used for a different saved version. Start a new export request.",
    );
  }
}
