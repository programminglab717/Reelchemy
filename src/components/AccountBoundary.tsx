"use client";
import {
  createContext,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  createAccountFetch,
  type AccountFetch,
  type AccountState,
} from "@/lib/account-fetch";
import {
  ACCOUNT_CHANGED_MESSAGE,
  ACCOUNT_EXPIRED_MESSAGE,
} from "@/lib/account-session";

const AccountContext = createContext<AccountFetch | null>(null);
export function useAccountFetch() {
  const request = useContext(AccountContext);
  if (!request)
    throw new Error("Private studio requests need an account boundary.");
  return request;
}
export function AccountBoundary({
  userId,
  children,
}: {
  userId: string;
  children: ReactNode;
}) {
  const [blocked, setBlocked] = useState<AccountState | null>(null);
  const request = useMemo(
    () => createAccountFetch(userId, setBlocked),
    [userId],
  );
  return (
    <AccountContext.Provider value={request}>
      {blocked && (
        <div className="account-session-notice" role="alert">
          <p>
            {blocked === "changed"
              ? ACCOUNT_CHANGED_MESSAGE
              : ACCOUNT_EXPIRED_MESSAGE}
          </p>
          <button type="button" onClick={() => window.location.reload()}>
            Reload studio
          </button>
        </div>
      )}
      {children}
    </AccountContext.Provider>
  );
}
