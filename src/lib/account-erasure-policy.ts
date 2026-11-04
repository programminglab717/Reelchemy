export const ACCOUNT_ERASURE_CONFIRMATION = "DELETE MY ACCOUNT";
export class AccountErasureUnavailable extends Error {
  readonly code = "ACCOUNT_ERASURE_UNAVAILABLE";
  constructor() {
    super("Account deletion needs attention from the studio operator.");
    this.name = "AccountErasureUnavailable";
  }
}
export class AccountErasureConflict extends Error {
  readonly code = "ACCOUNT_ERASURE_CONFLICT";
  constructor() {
    super(
      "Account deletion could not use this confirmation. Check its status or try again.",
    );
    this.name = "AccountErasureConflict";
  }
}
export class AccountErasureCapacity extends Error {
  readonly code = "ACCOUNT_ERASURE_CAPACITY";
  constructor() {
    super(
      "Account deletion is temporarily unavailable. Try again later or contact the studio operator.",
    );
    this.name = "AccountErasureCapacity";
  }
}
export function accountErasurePolicy(
  env: Record<string, string | undefined> = process.env,
) {
  function integer(
    name: string,
    fallback: number,
    minimum: number,
    maximum: number,
  ) {
    const raw = env[name];
    if (raw === undefined || raw === "") return fallback;
    if (!/^[1-9][0-9]*$/.test(raw)) throw new AccountErasureUnavailable();
    const value = Number(raw);
    if (!Number.isSafeInteger(value) || value < minimum || value > maximum)
      throw new AccountErasureUnavailable();
    return value;
  }
  const pending = integer("REELCHEMY_ERASURE_PENDING_COUNT", 100, 1, 10000);
  const journal = integer(
    "REELCHEMY_ERASURE_JOURNAL_COUNT",
    1000000,
    1,
    2000000,
  );
  if (pending > journal) throw new AccountErasureUnavailable();
  return { pending, journal };
}
