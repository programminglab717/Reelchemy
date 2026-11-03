"use client";
import { useEffect, useRef, useState } from "react";
import { useAccountFetch } from "./AccountBoundary";
import type { RenderJob } from "@/lib/schema";
import type {
  ExportFilePreview,
  ExportFileRemoval,
} from "@/lib/export-file-policy";
type Props = { job: RenderJob; onChange: (receipt: ExportFileRemoval) => void };
export function ExportFiles(props: Props) {
  return <ExportFilesReview key={props.job.id} {...props} />;
}
function ExportFilesReview({ job, onChange }: Props) {
  const accountFetch = useAccountFetch();
  const [preview, setPreview] = useState<ExportFilePreview | null>(null),
    [confirmation, setConfirmation] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [refresh, setRefresh] = useState(0);
  const alive = useRef(true),
    pending = useRef<AbortController | null>(null),
    change = useRef(onChange);
  useEffect(() => {
    change.current = onChange;
  }, [onChange]);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      pending.current?.abort();
    };
  }, []);
  const state = job.files?.state;
  useEffect(() => {
    if (state !== "queued" && state !== "working") return;
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function poll() {
      try {
        const response = await accountFetch(
          `/api/jobs/${encodeURIComponent(job.id)}/files`,
          {
            signal: AbortSignal.any([abort.signal, AbortSignal.timeout(10000)]),
          },
        );
        if (!response.ok) throw new Error();
        const { removal } = (await response.json()) as {
          removal: ExportFileRemoval | null;
        };
        if (abort.signal.aborted) return;
        if (
          !removal ||
          removal.jobId !== job.id ||
          removal.projectId !== job.projectId
        )
          throw new Error();
        change.current(removal);
        if (removal.state === "queued" || removal.state === "working")
          timer = setTimeout(() => void poll(), 1500);
      } catch {
        if (!abort.signal.aborted)
          setError(
            "Cleanup status is unavailable. Retry status to check the saved request.",
          );
      }
    }
    void poll();
    return () => {
      abort.abort();
      clearTimeout(timer);
    };
  }, [accountFetch, job.id, job.projectId, state, refresh]);
  async function submit(action: "preview" | "remove") {
    if (pending.current) return;
    const abort = new AbortController();
    pending.current = abort;
    setBusy(true);
    setError("");
    try {
      const response = await accountFetch(
        `/api/jobs/${encodeURIComponent(job.id)}/files`,
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
      const result = (await response.json()) as {
        error?: string;
        preview?: ExportFilePreview;
        removal?: ExportFileRemoval;
      };
      if (!response.ok)
        throw new Error(result.error || "Export cleanup could not be saved.");
      if (!alive.current) return;
      if (result.removal) {
        if (
          result.removal.jobId !== job.id ||
          result.removal.projectId !== job.projectId
        )
          throw new Error();
        change.current(result.removal);
        if (result.removal.state !== "failed") {
          setPreview(null);
          setConfirmation("");
        }
      }
      if (result.preview) {
        setPreview(result.preview);
        setConfirmation("");
      }
    } catch (failure) {
      if (alive.current && !abort.signal.aborted)
        setError(
          failure instanceof Error &&
            failure.name !== "TimeoutError" &&
            failure.name !== "TypeError"
            ? failure.message
            : "The response was interrupted. Keep this review and retry to check the saved request.",
        );
    } finally {
      pending.current = null;
      if (alive.current) setBusy(false);
    }
  }
  const waiting = state === "queued" || state === "working";
  return (
    <section
      className="export-files"
      aria-label="Export file storage"
      aria-busy={busy}
    >
      <h3>Export file storage</h3>
      <p>
        Your saved film, versions and original media stay in your studio.
        Removal keeps this export’s activity record and permanently removes its
        MP4, captions, thumbnail and review files. Download anything you need
        first.
      </p>
      {state === "completed" ? (
        <p role="status">
          Export files removed. You can create a fresh export from your saved
          film.
        </p>
      ) : waiting ? (
        <p role="status">
          {state === "working"
            ? "Removing reviewed export files…"
            : "Export file removal queued."}
        </p>
      ) : (
        <>
          {state === "failed" && <p role="alert">{job.files?.error}</p>}
          {!preview ? (
            <button
              className="subtle"
              disabled={busy}
              onClick={() => void submit("preview")}
            >
              {busy ? "Reviewing files…" : "Review export file removal"}
            </button>
          ) : (
            <>
              <p role="status">
                Remove {preview.files} file{preview.files === 1 ? "" : "s"} ·{" "}
                {(preview.bytes / 1024 ** 2).toFixed(2)} MB of export data. This
                cannot be undone.
              </p>
              <label>
                Type REMOVE EXPORT to confirm
                <input
                  aria-label="Export file removal confirmation"
                  value={confirmation}
                  disabled={busy}
                  autoComplete="off"
                  onChange={(event) => setConfirmation(event.target.value)}
                />
              </label>
              <div className="layer-fields">
                <button
                  className="subtle remove-export-files"
                  disabled={busy || confirmation !== "REMOVE EXPORT"}
                  onClick={() => void submit("remove")}
                >
                  {busy ? "Saving removal…" : "Permanently remove export files"}
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
                  Keep export files
                </button>
                <button
                  className="subtle"
                  disabled={busy}
                  onClick={() => void submit("preview")}
                >
                  Review current files again
                </button>
              </div>
            </>
          )}
        </>
      )}
      {error && <p role="alert">{error}</p>}
      {waiting && error && (
        <button
          className="subtle"
          onClick={() => {
            setError("");
            setRefresh((v) => v + 1);
          }}
        >
          Retry cleanup status
        </button>
      )}
    </section>
  );
}
