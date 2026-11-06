"use client";
import Link from "next/link";
import { useCallback, useState } from "react";
import { useAccountFetch } from "./AccountBoundary";
import { DeletionProgress, downloadDeletionReceipt } from "./DeletionProgress";
import { AiProviderSettings } from "./AiProviderSettings";
import {
  createDeletionReceipt,
  deletionStatusSchema,
  type DeletionReceipt,
  type DeletionStatus,
} from "@/lib/account-erasure-receipt";
import {
  markBrowserAccountErased,
  browserAccountErased,
} from "@/lib/browser-drafts";
export function AccountSettings({
  userId,
  email,
}: {
  userId: string;
  email: string;
}) {
  const request = useAccountFetch();
  const [receipt, setReceipt] = useState<DeletionReceipt | null>(null),
    [accepted, setAccepted] = useState<DeletionStatus>(),
    [inspect, setInspect] = useState(false),
    [downloaded, setDownloaded] = useState(false),
    [saved, setSaved] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [browserWarning, setBrowserWarning] = useState("");
  const approved = useCallback(
    (status: DeletionStatus) => {
      setAccepted(status);
      try {
        if (!browserAccountErased(localStorage, userId)) {
          markBrowserAccountErased(localStorage, userId);
          window.dispatchEvent(new Event("reelchemy-account-erased"));
        }
      } catch {
        setBrowserWarning(
          "This browser could not clear all saved recovery copies for this account. Clear this account’s copies on this device separately.",
        );
      }
    },
    [userId],
  );
  return (
    <main className="account-page">
      <section className="account-card account-settings">
        {receipt && (accepted || inspect) ? (
          <>
            {browserWarning && <p role="alert">{browserWarning}</p>}
            <DeletionProgress
              receipt={receipt}
              initialStatus={accepted}
              onStatus={approved}
            />
            {!accepted && (
              <button type="button" onClick={() => setInspect(false)}>
                Return to confirmation
              </button>
            )}
          </>
        ) : (
          <>
            <nav>
              <Link href="/">Back to studio</Link>
              <Link href="/account/deletion">Check a deletion receipt</Link>
            </nav>
            <h1>Account settings</h1>
            <p>Signed in as {email}</p>
            <AiProviderSettings />
            <section
              className="account-delete-warning"
              aria-label="Permanent account deletion"
            >
              <h2>Delete your account and studio</h2>
              <p>
                This permanently removes your account, every project including
                Trash and saved versions, uploaded media, and exports. It cannot
                be undone. Download any films or editable project ZIPs you want
                to keep first.
              </p>
              <p>
                Previously downloaded copies and older stored backups are
                handled separately. Restoring an older backup will not reopen
                your account.
              </p>
              {!receipt ? (
                <button
                  type="button"
                  className="danger"
                  onClick={() => {
                    try {
                      setReceipt(createDeletionReceipt());
                      setError("");
                    } catch {
                      setError(
                        "Your browser could not prepare a private deletion receipt. Use a secure connection and try again.",
                      );
                    }
                  }}
                >
                  Prepare account deletion
                </button>
              ) : (
                <>
                  <p>
                    Save your private deletion receipt before confirming. It
                    lets you check progress after sign-out or an interrupted
                    reply. Keep it private; it contains no password.
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      downloadDeletionReceipt(receipt);
                      setDownloaded(true);
                    }}
                  >
                    Download deletion receipt
                  </button>
                  <form
                    onSubmit={async (event) => {
                      event.preventDefault();
                      if (!saved || busy) return;
                      setBusy(true);
                      setError("");
                      const form = event.currentTarget,
                        data = new FormData(form);
                      const body = JSON.stringify({
                        action: "confirm",
                        requestId: receipt.requestId,
                        receipt: receipt.receipt,
                        password: String(data.get("password") || ""),
                        confirmation: String(data.get("confirmation") || ""),
                      });
                      const password = form.elements.namedItem("password");
                      if (password instanceof HTMLInputElement)
                        password.value = "";
                      try {
                        const response = await request(
                          "/api/account/deletion",
                          {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body,
                            signal: AbortSignal.timeout(20000),
                          },
                        );
                        if (!response.ok) {
                          const failure = await response
                            .json()
                            .catch(() => null);
                          throw new Error(
                            typeof failure?.error === "string"
                              ? failure.error
                              : "Deletion could not be confirmed. Keep your receipt and check its status before retrying.",
                          );
                        }
                        const status = deletionStatusSchema.parse(
                          await response.json(),
                        );
                        if (status.requestId !== receipt.requestId)
                          throw new Error(
                            "The reply did not match your receipt. Check its status before retrying.",
                          );
                        approved(status);
                      } catch (error) {
                        setError(
                          error instanceof TypeError ||
                            (error instanceof Error &&
                              ["AbortError", "TimeoutError"].includes(
                                error.name,
                              ))
                            ? "The deletion reply was interrupted. Keep your receipt and check the saved request before retrying."
                            : error instanceof Error && !("issues" in error)
                              ? error.message
                              : "Deletion could not be confirmed. Keep your receipt and check its status before retrying.",
                        );
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    <label className="deletion-receipt-check">
                      <input
                        type="checkbox"
                        checked={saved}
                        disabled={!downloaded || busy}
                        required
                        onChange={(event) => setSaved(event.target.checked)}
                      />
                      I have saved my private deletion receipt.
                    </label>
                    <label>
                      Current password
                      <input
                        name="password"
                        type="password"
                        autoComplete="current-password"
                        required
                        maxLength={128}
                        disabled={busy}
                      />
                    </label>
                    <label>
                      Type DELETE MY ACCOUNT to confirm
                      <input
                        name="confirmation"
                        autoComplete="off"
                        required
                        pattern="DELETE MY ACCOUNT"
                        maxLength={17}
                        disabled={busy}
                      />
                    </label>
                    <button
                      type="submit"
                      className="danger"
                      disabled={!saved || busy}
                    >
                      {busy
                        ? "Confirming deletion…"
                        : "Permanently delete my account"}
                    </button>
                  </form>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => setInspect(true)}
                  >
                    Check saved request
                  </button>
                </>
              )}
            </section>
            {error && <p role="alert">{error}</p>}
          </>
        )}
      </section>
    </main>
  );
}
