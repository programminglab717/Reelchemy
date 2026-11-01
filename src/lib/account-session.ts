// This header binds a browser tab to its server-rendered account. The verified
// cookie remains the authority; supplying or omitting this header grants nothing.
export const ACCOUNT_HEADER = "X-Reelchemy-User-Id";
export const ACCOUNT_STATUS_HEADER = "X-Reelchemy-Account-Status";
export const ACCOUNT_CHANGED_MESSAGE =
  "The account in this browser changed. Download any unsaved work, then reload to continue.";
export const ACCOUNT_EXPIRED_MESSAGE =
  "Your session ended. Download any unsaved work, then reload to sign in.";
export function accountMismatch(headers: Headers, userId: string) {
  const expected = headers.get(ACCOUNT_HEADER);
  if (expected === null || expected === userId) return null;
  return Response.json(
    { error: ACCOUNT_CHANGED_MESSAGE, code: "ACCOUNT_CHANGED" },
    {
      status: 409,
      headers: {
        "Cache-Control": "private, no-store",
        [ACCOUNT_STATUS_HEADER]: "changed",
      },
    },
  );
}
