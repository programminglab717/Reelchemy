import { LimitConfigurationError } from "./limits-policy";
export const DEFAULT_MEDIA_STORAGE_BYTES = 512 * 1024 * 1024;
export function mediaStorageLimit(
  env: Record<string, string | undefined> = process.env,
) {
  const configured = env.REELCHEMY_MEDIA_STORAGE_BYTES;
  if (configured === undefined || configured === "")
    return DEFAULT_MEDIA_STORAGE_BYTES;
  const bytes = Number(configured);
  if (
    !/^\d+$/.test(configured) ||
    !Number.isSafeInteger(bytes) ||
    bytes < 1024 * 1024 ||
    bytes > 1024 ** 4
  )
    throw new LimitConfigurationError();
  return bytes;
}
export class MediaStorageLimitError extends Error {
  readonly code = "MEDIA_STORAGE_LIMIT";
  constructor(
    readonly usedBytes: number,
    readonly limitBytes: number,
    readonly requiredBytes: number,
  ) {
    super(
      "The processed media exceeds your studio's remaining allowance. Reduce image dimensions or clip duration, or contact the operator.",
    );
  }
}
