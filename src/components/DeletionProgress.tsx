"use client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  deletionStatusSchema,
  type DeletionReceipt,
  type DeletionStatus,
} from "@/lib/account-erasure-receipt";
export function downloadDeletionReceipt(receipt: DeletionReceipt) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(receipt, null, 2)], { type: "application/json" }),
  );
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `reelchemy-deletion-${receipt.requestId}.json`;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
const headings = {
  requested: "Deletion requested",
  cleaning: "Removing your account",
  blocked: "Deletion needs attention",
  completed: "Account deleted",
};
export function DeletionProgress({
  receipt,
  initialStatus,
  onStatus,
}: {
  receipt: DeletionReceipt;
  initialStatus?: DeletionStatus;
  onStatus?: (status: DeletionStatus) => void;
}) {
  const [status, setStatus] = useState(initialStatus),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const inflight = useRef(false);
  const check = useCallback(
    async (signal?: AbortSignal) => {
      if (inflight.current) return;
      inflight.current = true;
      setBusy(true);
      setError("");
      try {
        const response = await fetch("/api/account/deletion", {
          method: "POST",
          credentials: "omit",
          cache: "no-store",
          redirect: "error",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "status",
            requestId: receipt.requestId,
            receipt: receipt.receipt,
          }),
          signal: signal
            ? AbortSignal.any([signal, AbortSignal.timeout(10000)])
            : AbortSignal.timeout(10000),
        });
        if (!response.ok) {
          void response.body?.cancel().catch(() => {});
          throw new Error(
            response.status === 404
              ? "No matching deletion request was found. Check the receipt, or return to confirmation if you have not sent it yet."
              : "Deletion progress is temporarily unavailable. Keep your receipt and try again.",
          );
        }
        const next = deletionStatusSchema.parse(await response.json());
        if (next.requestId !== receipt.requestId)
          throw new Error("The progress response did not match your receipt.");
        if (signal?.aborted) return;
        setStatus(next);
        onStatus?.(next);
      } catch (error) {
        if (!signal?.aborted)
          setError(
            error instanceof Error && !("issues" in error)
              ? error.message
              : "Deletion progress could not be read. Keep your receipt and try again.",
          );
      } finally {
        inflight.current = false;
        if (!signal?.aborted) setBusy(false);
      }
    },
    [receipt.requestId, receipt.receipt, onStatus],
  );
  const state = status?.state;
  useEffect(() => {
    if (state === "completed") return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      if (document.visibilityState === "visible")
        await check(controller.signal);
      if (!controller.signal.aborted)
        timer = setTimeout(poll, state === "blocked" ? 30000 : 5000);
    };
    timer = setTimeout(poll, state ? 5000 : 0);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [check, state]);
  return (
    <section
      className="deletion-progress"
      aria-label="Account deletion progress"
    >
      <h2>{status ? headings[status.state] : "Check your deletion request"}</h2>
      {status?.state === "completed" ? (
        <p>
          Your account and studio have been removed from active service. Keep
          this receipt if you need to check the request again.
        </p>
      ) : status?.state === "blocked" ? (
        <p>
          Your account is closed to sign-in. Cleanup needs attention from the
          studio operator; keep this receipt for support.
        </p>
      ) : status ? (
        <p>
          Your account is closed to sign-in while its projects, media and
          exports are removed. This can take time while active work shuts down.
        </p>
      ) : (
        <p>This private receipt checks progress without signing in.</p>
      )}
      <p className="deletion-request-id">
        Request: <code>{receipt.requestId}</code>
      </p>
      {error && <p role="alert">{error}</p>}
      <div className="dialog-actions">
        <button type="button" disabled={busy} onClick={() => void check()}>
          {busy ? "Checking…" : "Check progress"}
        </button>
        <button type="button" onClick={() => downloadDeletionReceipt(receipt)}>
          Download deletion receipt
        </button>
      </div>
      <nav>
        <Link href="/sign-in">Go to sign in</Link>
        <Link href="/account/deletion">Open another receipt</Link>
      </nav>
    </section>
  );
}
