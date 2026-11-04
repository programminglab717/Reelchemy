export const MAIL_RECORD_BYTES = 64 * 1024;
export const MAIL_LIFETIME_MS = 60 * 60 * 1000;
export const MAIL_LEASE_MS = 120000;
export const MAIL_MAX_ATTEMPTS = 5;
export const MAIL_BATCH_SIZE = 20;
export class MailUnavailable extends Error {
  constructor() {
    super("Account mail is unavailable. Contact the studio operator.");
    this.name = "MailUnavailable";
  }
}
export class MailCapacity extends Error {
  constructor() {
    super("Account mail is temporarily full. Try again later.");
    this.name = "MailCapacity";
  }
}
export function mailPolicy(env: NodeJS.ProcessEnv = process.env) {
  function integer(
    name: string,
    fallback: number,
    minimum: number,
    maximum: number,
  ) {
    const raw = env[name];
    if (raw === undefined || raw === "") return fallback;
    if (!/^[1-9][0-9]*$/.test(raw)) throw new MailUnavailable();
    const value = Number(raw);
    if (!Number.isSafeInteger(value) || value < minimum || value > maximum)
      throw new MailUnavailable();
    return value;
  }
  return {
    count: integer("REELCHEMY_MAIL_PENDING_COUNT", 1000, 1, 2000),
    bytes: integer(
      "REELCHEMY_MAIL_PENDING_BYTES",
      16 * 1024 ** 2,
      MAIL_RECORD_BYTES,
      128 * 1024 ** 2,
    ),
  };
}
