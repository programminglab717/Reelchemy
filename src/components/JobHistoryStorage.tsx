"use client";
import { useEffect, useRef, useState } from "react";
import { useAccountFetch } from "./AccountBoundary";
import type { JobHistoryUsage } from "@/lib/job-history-policy";
import type { JobHistorySummary, JobHistoryPage } from "@/lib/job-history-page";
import type {
  JobHistoryPreview,
  JobHistoryRetirement,
} from "@/lib/job-history-retention";
const amount = (bytes: number) =>
  bytes >= 1024 ** 2
    ? `${(bytes / 1024 ** 2).toFixed(2)} MB`
    : `${(bytes / 1024).toFixed(1)} KB`;
const integer = (value: unknown) =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const token = (value: unknown) =>
  typeof value === "string" && /^v1\.[A-Za-z0-9_-]{48,60}$/.test(value);
export function JobHistoryStorage({
  refreshKey,
  onRetired,
}: {
  refreshKey: string;
  onRetired: (receipt: JobHistoryRetirement) => void;
}) {
  const request = useAccountFetch(),
    dialog = useRef<HTMLDialogElement>(null),
    opener = useRef<HTMLButtonElement>(null),
    heading = useRef<HTMLHeadingElement>(null),
    pending = useRef<AbortController | null>(null),
    alive = useRef(true);
  const [usage, setUsage] = useState<JobHistoryUsage | null>(null),
    [usageError, setUsageError] = useState(""),
    [revision, setRevision] = useState(0),
    [open, setOpen] = useState(false);
  const [page, setPage] = useState<JobHistoryPage | null>(null),
    [cursors, setCursors] = useState<(string | null)[]>([null]),
    [index, setIndex] = useState(0),
    [refresh, setRefresh] = useState(0),
    [settled, setSettled] = useState(""),
    [pageError, setPageError] = useState("");
  const [selected, setSelected] = useState<JobHistorySummary | null>(null),
    [preview, setPreview] = useState<JobHistoryPreview | null>(null),
    [retired, setRetired] = useState<JobHistoryRetirement | null>(null),
    [confirmation, setConfirmation] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const anchor = useRef<string | null>(null),
    before = cursors[index],
    loadKey = JSON.stringify([before, refresh]),
    loading = loadKey !== settled,
    selectedId = selected?.id;
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      pending.current?.abort();
    };
  }, []);
  useEffect(() => {
    if (selectedId) heading.current?.focus();
  }, [selectedId]);
  useEffect(() => {
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function load() {
      try {
        const response = await request("/api/workspace/job-history", {
          signal: AbortSignal.any([abort.signal, AbortSignal.timeout(15000)]),
        });
        if (!response.ok) {
          const result = await response.json().catch(() => null);
          throw new Error(
            result?.code === "JOB_HISTORY_UNAVAILABLE"
              ? "operator"
              : "unavailable",
          );
        }
        const value: JobHistoryUsage = await response.json();
        if (
          !value ||
          ![
            value.bytes,
            value.reservedBytes,
            value.fullJobs,
            value.retiredJobs,
            value.pendingJobs,
            value.limitBytes,
            value.limitJobs,
            value.limitRetired,
            value.reservationBytes,
          ].every(integer) ||
          value.limitBytes < 1 ||
          value.limitJobs < 1 ||
          value.limitRetired < 1
        )
          throw new Error();
        if (abort.signal.aborted) return;
        setUsage(value);
        setUsageError("");
        if (value.pendingJobs > 0) timer = setTimeout(() => void load(), 3000);
      } catch (problem) {
        if (!abort.signal.aborted)
          setUsageError(
            problem instanceof Error && problem.message === "operator"
              ? "Export activity needs attention from the studio operator. Your current edits are kept."
              : "Export activity allowance is unavailable. Refresh to retry; you can keep editing.",
          );
      }
    }
    void load();
    return () => {
      abort.abort();
      clearTimeout(timer);
    };
  }, [request, revision, refreshKey]);
  useEffect(() => {
    if (!open) return;
    const element = dialog.current,
      button = opener.current;
    element?.showModal();
    return () => {
      element?.close();
      if (button?.isConnected) button.focus();
    };
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const abort = new AbortController(),
      query = new URLSearchParams();
    if (anchor.current) query.set("anchor", anchor.current);
    if (before) query.set("before", before);
    void (async () => {
      try {
        const response = await request(
          `/api/workspace/job-history/records?${query}`,
          {
            signal: AbortSignal.any([abort.signal, AbortSignal.timeout(15000)]),
          },
        );
        if (!response.ok) throw new Error();
        const value: JobHistoryPage = await response.json();
        if (
          !value ||
          !Array.isArray(value.items) ||
          value.items.length > 20 ||
          !token(value.anchor) ||
          (value.nextBefore !== null && !token(value.nextBefore)) ||
          !integer(value.unavailable) ||
          value.unavailable > 20 ||
          value.items.some(
            (item) =>
              !item ||
              typeof item.id !== "string" ||
              item.id.length > 160 ||
              typeof item.projectId !== "string" ||
              item.projectId.length > 160 ||
              typeof item.projectName !== "string" ||
              item.projectName.length > 100 ||
              !integer(item.bytes) ||
              typeof item.inTrash !== "boolean" ||
              typeof item.eligible !== "boolean" ||
              !["completed", "failed", "cancelled"].includes(item.status),
          )
        )
          throw new Error();
        if (!abort.signal.aborted) {
          anchor.current = value.anchor;
          setPage(value);
          setPageError("");
        }
      } catch {
        if (!abort.signal.aborted)
          setPageError(
            "Export activity could not be loaded. Refresh to retry; your edits are kept.",
          );
      } finally {
        if (!abort.signal.aborted) setSettled(loadKey);
      }
    })();
    return () => abort.abort();
  }, [open, request, before, refresh, loadKey]);
  function reload() {
    anchor.current = null;
    setCursors([null]);
    setIndex(0);
    setRefresh((n) => n + 1);
  }
  function select(item: JobHistorySummary) {
    if (selectedId === item.id) heading.current?.focus();
    setSelected(item);
    setPreview(null);
    setRetired(null);
    setConfirmation("");
    setError("");
  }
  async function submit(action: "preview" | "retire") {
    if (!selected || pending.current) return;
    const chosen = selected,
      abort = new AbortController();
    pending.current = abort;
    setBusy(true);
    setError("");
    try {
      const response = await request(
        `/api/jobs/${encodeURIComponent(chosen.id)}/history`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            action === "preview"
              ? { action }
              : { action, digest: preview?.digest, confirmation },
          ),
          signal: AbortSignal.any([abort.signal, AbortSignal.timeout(20000)]),
        },
      );
      const value = await response.json();
      if (!response.ok)
        throw new Error(
          typeof value.error === "string" && value.error.length <= 1000
            ? value.error
            : "Export details could not be retired.",
        );
      if (!alive.current) return;
      if (value.retirement) {
        const receipt: JobHistoryRetirement = value.retirement;
        if (
          receipt.jobId !== chosen.id ||
          receipt.projectId !== chosen.projectId ||
          typeof receipt.digest !== "string" ||
          !/^[a-f0-9]{64}$/.test(receipt.digest) ||
          typeof receipt.retiredAt !== "string" ||
          receipt.retiredAt.length > 40 ||
          !integer(receipt.sourceFiles) ||
          receipt.sourceFiles > 1024
        )
          throw new Error();
        setRetired(receipt);
        setPreview(null);
        setConfirmation("");
        onRetired(receipt);
        setRevision((n) => n + 1);
        reload();
      } else if (value.preview) {
        const review: JobHistoryPreview = value.preview;
        if (
          review.jobId !== chosen.id ||
          review.projectId !== chosen.projectId ||
          typeof review.digest !== "string" ||
          !/^[a-f0-9]{64}$/.test(review.digest) ||
          ![
            review.detailsBytes,
            review.retainedBytes,
            review.reclaimedBytes,
            review.sourceFiles,
          ].every(integer) ||
          review.sourceFiles > 1024
        )
          throw new Error();
        setPreview(review);
        setConfirmation("");
      } else throw new Error();
    } catch (problem) {
      if (alive.current && !abort.signal.aborted)
        setError(
          problem instanceof Error &&
            problem.name === "Error" &&
            !!problem.message
            ? problem.message
            : "The response was interrupted. Keep this review and retry to check the saved result.",
        );
    } finally {
      pending.current = null;
      if (alive.current) setBusy(false);
    }
  }
  return (
    <section
      className="job-history-storage"
      aria-label="Export activity allowance"
    >
      <div className="layer-fields">
        <strong>Export activity</strong>
        <button className="subtle" onClick={() => setRevision((n) => n + 1)}>
          Refresh export activity allowance
        </button>
        <button
          className="subtle"
          ref={opener}
          onClick={() => {
            reload();
            setSelected(null);
            setPreview(null);
            setRetired(null);
            setError("");
            setOpen(true);
          }}
        >
          Manage export activity
        </button>
      </div>
      {usage ? (
        <p role="status" aria-label="Export activity usage">
          {amount(usage.bytes)} details · {amount(usage.reservedBytes)} reserved
          · {amount(usage.limitBytes)} allowance. {usage.fullJobs} of{" "}
          {usage.limitJobs} detailed exports; {usage.retiredJobs} of{" "}
          {usage.limitRetired} retired activity records.
        </p>
      ) : (
        !usageError && <p role="status">Loading export activity allowance…</p>
      )}
      {usageError && <p role="alert">{usageError}</p>}
      {open && (
        <dialog
          ref={dialog}
          className="delete-project-dialog job-history-dialog"
          aria-labelledby="job-history-title"
          onCancel={(event) => {
            if (busy) event.preventDefault();
            else setOpen(false);
          }}
        >
          <h2 id="job-history-title">Manage export activity</h2>
          <p>
            Keep your current edit open while reviewing earlier exports. Your
            saved films and original media stay in your studio. Retiring details
            removes an export’s report, event log and saved export timeline. A
            small activity record and its original-media references remain. This
            does not free original-media storage.
          </p>
          <div className="dialog-actions">
            <button
              className="subtle"
              disabled={busy}
              onClick={() => {
                reload();
                setSelected(null);
                setPreview(null);
                setRetired(null);
                setError("");
              }}
            >
              Refresh export activity
            </button>
            <button
              className="subtle"
              disabled={busy}
              onClick={() => setOpen(false)}
            >
              Close activity manager
            </button>
          </div>
          {selected && (
            <section
              className="retained-export-review"
              aria-label="Selected export activity"
              aria-busy={busy}
            >
              <h3 ref={heading} tabIndex={-1}>
                {selected.projectName} · export {selected.id.slice(0, 8)}
              </h3>
              {retired ? (
                <p role="status">
                  Export details retired. Its activity record and original-media
                  references are kept.
                </p>
              ) : (
                <>
                  <p>
                    <a
                      href={`/api/jobs/${encodeURIComponent(selected.id)}/history`}
                    >
                      Download export activity JSON
                    </a>
                  </p>
                  {!preview ? (
                    <button
                      className="subtle"
                      disabled={busy}
                      onClick={() => void submit("preview")}
                    >
                      {busy
                        ? "Reviewing details…"
                        : "Review export detail retirement"}
                    </button>
                  ) : (
                    <>
                      <p role="status">
                        {amount(preview.detailsBytes)} of details becomes{" "}
                        {amount(preview.retainedBytes)} of retained activity
                        data. {preview.sourceFiles} original-media reference
                        {preview.sourceFiles === 1 ? "" : "s"} will remain.
                        Retiring details cannot be undone.
                      </p>
                      {preview.retainedBytes > preview.detailsBytes && (
                        <p>
                          Retiring this small record uses{" "}
                          {amount(preview.retainedBytes - preview.detailsBytes)}{" "}
                          more storage and frees one detailed-export slot.
                        </p>
                      )}
                      <label>
                        Type RETIRE EXPORT DETAILS to confirm
                        <input
                          aria-label="Export detail retirement confirmation"
                          value={confirmation}
                          disabled={busy}
                          autoComplete="off"
                          onChange={(event) =>
                            setConfirmation(event.target.value)
                          }
                        />
                      </label>
                      <div className="dialog-actions">
                        <button
                          className="subtle"
                          disabled={
                            busy || confirmation !== "RETIRE EXPORT DETAILS"
                          }
                          onClick={() => void submit("retire")}
                        >
                          {busy
                            ? "Retiring details…"
                            : "Retire reviewed export details"}
                        </button>
                        <button
                          className="subtle"
                          disabled={busy}
                          onClick={() => {
                            setPreview(null);
                            setConfirmation("");
                            setError("");
                          }}
                        >
                          Keep export details
                        </button>
                        <button
                          className="subtle"
                          disabled={busy}
                          onClick={() => void submit("preview")}
                        >
                          Review current export details again
                        </button>
                      </div>
                    </>
                  )}
                </>
              )}
              {error && <p role="alert">{error}</p>}
            </section>
          )}
          <div aria-busy={loading}>
            {loading ? (
              <p role="status">Loading export activity…</p>
            ) : pageError ? (
              <p role="alert">{pageError}</p>
            ) : (
              <>
                {!page?.items.length && (
                  <p>No detailed exports on this page.</p>
                )}
                <ul className="retained-export-list">
                  {page?.items.map((item) => (
                    <li key={item.id}>
                      <strong>{item.projectName}</strong>
                      <p>
                        {item.status} · {amount(item.bytes)} details ·{" "}
                        {item.id.slice(0, 8)}
                      </p>
                      {item.inTrash ? (
                        <p>
                          Restore this project from Trash before reviewing its
                          details.
                        </p>
                      ) : !item.eligible ? (
                        <p>
                          These details aren’t ready to retire. Finish this
                          export’s file cleanup or contact the studio operator,
                          then refresh.
                        </p>
                      ) : (
                        <button
                          className="subtle"
                          disabled={busy}
                          onClick={() => select(item)}
                        >
                          Review activity for export {item.id.slice(0, 8)}
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
                {!!page?.unavailable && (
                  <p>
                    {page.unavailable} activity record(s) need operator review.
                    Other pages remain available.
                  </p>
                )}
                <div className="dialog-actions">
                  <button
                    className="subtle"
                    disabled={busy || index === 0}
                    onClick={() => {
                      setIndex((n) => n - 1);
                      setSelected(null);
                    }}
                  >
                    Newer export activity
                  </button>
                  <button
                    className="subtle"
                    disabled={busy || !page?.nextBefore}
                    onClick={() => {
                      setCursors((old) => [
                        ...old.slice(0, index + 1),
                        page!.nextBefore,
                      ]);
                      setIndex((n) => n + 1);
                      setSelected(null);
                    }}
                  >
                    Older export activity
                  </button>
                </div>
              </>
            )}
          </div>
        </dialog>
      )}
    </section>
  );
}
