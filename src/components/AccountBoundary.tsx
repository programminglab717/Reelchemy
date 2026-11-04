"use client";
import {
  createContext,
  useContext,
  useMemo,
  useState,
  useEffect,
  type ReactNode,
} from "react";
import {
  createAccountFetch,
  type AccountFetch,
  type AccountState,
  AccountSessionError,
} from "@/lib/account-fetch";
import {
  ACCOUNT_CHANGED_MESSAGE,
  ACCOUNT_EXPIRED_MESSAGE,
} from "@/lib/account-session";
import {
  browserAccountErased,
  ACCOUNT_ERASED_PREFIX,
} from "@/lib/browser-drafts";

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
  keepReceiptAfterErasure = false,
}: {
  userId: string;
  children: ReactNode;
  keepReceiptAfterErasure?: boolean;
}) {
  const [blocked, setBlocked] = useState<AccountState | null>(null);
  const [erased, setErased] = useState(false);
  const request = useMemo(() => {
    const fetch = createAccountFetch(userId, setBlocked);
    return async (url: string, init?: RequestInit) => {
      let removed = false;
      try {
        removed = browserAccountErased(window.localStorage, userId);
      } catch {}
      if (removed) {
        setErased(true);
        throw new AccountSessionError("expired");
      }
      return fetch(url, init);
    };
  }, [userId]);
  useEffect(() => {
    const check = () => {
      try {
        if (browserAccountErased(window.localStorage, userId)) setErased(true);
      } catch {}
    };
    const changed = (event: StorageEvent) => {
      if (event.key === `${ACCOUNT_ERASED_PREFIX}${encodeURIComponent(userId)}`)
        check();
    };
    check();
    window.addEventListener("storage", changed);
    window.addEventListener("reelchemy-account-erased", check);
    return () => {
      window.removeEventListener("storage", changed);
      window.removeEventListener("reelchemy-account-erased", check);
    };
  }, [userId]);
  return (
    <AccountContext.Provider value={request}>
      {erased && !keepReceiptAfterErasure && (
        <div className="account-session-notice" role="alert">
          <p>Account deletion was requested. This studio is closed.</p>
          <a href="/account/deletion">
            Check deletion with your private receipt
          </a>
        </div>
      )}
      {blocked && !erased && (
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
      {(!erased || keepReceiptAfterErasure) && children}
    </AccountContext.Provider>
  );
}
