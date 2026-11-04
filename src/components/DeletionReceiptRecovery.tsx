"use client";
import Link from "next/link";
import { useState } from "react";
import {
  parseDeletionReceipt,
  type DeletionReceipt,
} from "@/lib/account-erasure-receipt";
import { DeletionProgress } from "./DeletionProgress";
export function DeletionReceiptRecovery() {
  const [receipt, setReceipt] = useState<DeletionReceipt | null>(null),
    [error, setError] = useState("");
  return (
    <main className="account-page">
      <section className="account-card account-settings">
        {receipt ? (
          <DeletionProgress key={receipt.requestId} receipt={receipt} />
        ) : (
          <>
            <h1>Check account deletion</h1>
            <p>
              Open the private receipt you saved before confirming deletion. You
              do not need to sign in. The receipt stays in this page and is not
              saved to browser storage or added to the address.
            </p>
            <label>
              Private deletion receipt
              <input
                type="file"
                accept=".json,application/json"
                onChange={async (event) => {
                  const input = event.currentTarget,
                    file = input.files?.[0];
                  input.value = "";
                  if (!file) return;
                  setError("");
                  try {
                    if (file.size > 2048)
                      throw new Error(
                        "Choose the small private account-deletion receipt downloaded from this studio.",
                      );
                    setReceipt(parseDeletionReceipt(await file.text()));
                  } catch (error) {
                    setError(
                      error instanceof Error
                        ? error.message
                        : "The receipt could not be opened.",
                    );
                  }
                }}
              />
            </label>
          </>
        )}
        {error && <p role="alert">{error}</p>}
        <nav>
          <Link href="/">Back to studio</Link>
          <Link href="/sign-in">Sign in</Link>
          {receipt && (
            <button type="button" onClick={() => setReceipt(null)}>
              Choose another receipt
            </button>
          )}
        </nav>
      </section>
    </main>
  );
}
