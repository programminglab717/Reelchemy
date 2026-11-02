import { LimitConfigurationError } from "./limits-policy";
export const DEFAULT_MEDIA_STORAGE_BYTES = 512 * 1024 * 1024;
export const DEFAULT_SHARED_MEDIA_STORAGE_BYTES = 8 * 1024 ** 3;
export function validatedSharedMediaBytes(value: number) {
  if (
    !Number.isSafeInteger(value) ||
    value < 1024 ** 2 ||
    value > 4 * 1024 ** 4
  )
    throw new LimitConfigurationError();
  return value;
}
export function sharedMediaStorageLimit(
  env: Readonly<Record<string, string | undefined>> = process.env,
) {
  const raw = env.REELCHEMY_MEDIA_SHARED_STORAGE_BYTES;
  const value =
    raw === undefined || raw === ""
      ? DEFAULT_SHARED_MEDIA_STORAGE_BYTES
      : Number(raw);
  if (
    (raw !== undefined && raw !== "" && !/^\d+$/.test(raw)) ||
    value < mediaStorageLimit(env)
  )
    throw new LimitConfigurationError();
  return validatedSharedMediaBytes(value);
}
export function mediaStorageLimit(
  env: Readonly<Record<string, string | undefined>> = process.env,
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
  readonly code: "MEDIA_STORAGE_LIMIT" | "MEDIA_SERVICE_STORAGE_LIMIT";
  constructor(
    readonly usedBytes: number,
    readonly limitBytes: number,
    readonly requiredBytes: number,
    readonly scope: "studio" | "service" = "studio",
  ) {
    super(
      scope === "service"
        ? "Shared media storage is full. Keep your file and contact the studio operator, or retry after storage is available."
        : "The processed media exceeds your studio's remaining allowance. Reduce image dimensions or clip duration, or contact the operator.",
    );
    this.code =
      scope === "service"
        ? "MEDIA_SERVICE_STORAGE_LIMIT"
        : "MEDIA_STORAGE_LIMIT";
  }
}
