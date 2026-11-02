import { PROJECT_VIEW_HEADER, EDITOR_PROJECT_VIEW } from "./project-view";
import {
  ACCOUNT_HEADER,
  ACCOUNT_STATUS_HEADER,
  ACCOUNT_CHANGED_MESSAGE,
  ACCOUNT_EXPIRED_MESSAGE,
} from "./account-session";

export type AccountState = "changed" | "expired";
export type AccountFetch = (
  url: string,
  init?: RequestInit,
) => Promise<Response>;
export class AccountSessionError extends Error {
  constructor(public readonly state: AccountState) {
    super(
      state === "changed" ? ACCOUNT_CHANGED_MESSAGE : ACCOUNT_EXPIRED_MESSAGE,
    );
  }
}
export function createAccountFetch(
  userId: string,
  onBlocked: (state: AccountState) => void,
  transport: typeof fetch = fetch,
  origin: () => string = () => window.location.origin,
): AccountFetch {
  let blocked: AccountState | null = null;
  return async (url, init) => {
    if (blocked) throw new AccountSessionError(blocked);
    const target = new URL(url, origin());
    if (
      target.origin !== origin() ||
      !target.pathname.startsWith("/api/") ||
      target.username ||
      target.password
    )
      throw new Error("Private requests must use this studio's API.");
    const headers = new Headers(init?.headers);
    headers.set(ACCOUNT_HEADER, userId);
    headers.set(PROJECT_VIEW_HEADER, EDITOR_PROJECT_VIEW);
    const response = await transport(target.href, {
      ...init,
      headers,
      credentials: "same-origin",
      cache: "no-store",
      redirect: "error",
    });
    if (response.headers.get(ACCOUNT_STATUS_HEADER) === "changed")
      blocked = "changed";
    else if (response.status === 401) blocked = "expired";
    if (blocked) {
      void response.body?.cancel().catch(() => {});
      onBlocked(blocked);
      throw new AccountSessionError(blocked);
    }
    return response;
  };
}
