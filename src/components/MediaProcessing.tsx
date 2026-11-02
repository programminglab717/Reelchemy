"use client";
import { useEffect, useRef, useState } from "react";
import { useAccountFetch } from "./AccountBoundary";
import { MEDIA_PROCESSING_EVENT } from "@/lib/media-upload-intent";
import type { MediaReceipt } from "@/lib/media-processing-store";
type Page = {
  requests: MediaReceipt[];
  nextOffset: number | null;
  activeCount?: number;
};
const active = (request: MediaReceipt) =>
  ["receiving", "queued", "working", "cancelling"].includes(request.state);
function label(request: MediaReceipt) {
  if (request.cleanupPending)
    return request.state === "completed"
      ? "Ready · cleaning temporary files"
      : "Cleaning temporary files";
  return {
    receiving: "Receiving file",
    queued: "Waiting to prepare",
    working: "Preparing media",
    cancelling: "Cancelling",
    completed:
      request.operation === "import"
        ? "Imported"
        : request.operation === "waveform"
          ? "Waveform ready"
          : "Added to project",
    failed: "Could not finish",
    cancelled: "Cancelled",
  }[request.state];
}
export function MediaProcessing({
  onOpen,
  disabled,
}: {
  onOpen: (id: string) => Promise<void>;
  disabled: boolean;
}) {
  const accountFetch = useAccountFetch();
  const [page, setPage] = useState<Page | null>(null),
    [offset, setOffset] = useState(0),
    [revision, setRevision] = useState(0);
  const [expanded, setExpanded] = useState(false),
    [error, setError] = useState(""),
    [pending, setPending] = useState<string | null>(null);
  const firstLoad = useRef(true);
  useEffect(() => {
    const controller = new AbortController();
    let loading = false;
    async function load() {
      if (loading) return;
      loading = true;
      try {
        const response = await accountFetch(
          `/api/workspace/media-requests?offset=${offset}`,
          {
            cache: "no-store",
            signal: AbortSignal.any([
              controller.signal,
              AbortSignal.timeout(10000),
            ]),
          },
        );
        const result = await response.json();
        if (!response.ok)
          throw new Error(
            result.error || "Could not refresh media processing.",
          );
        if (controller.signal.aborted) return;
        setPage(result);
        setError("");
        if (firstLoad.current) {
          firstLoad.current = false;
          if ((result.requests as MediaReceipt[]).some(active))
            setExpanded(true);
        }
      } catch (error) {
        if (!controller.signal.aborted)
          setError(
            error instanceof Error
              ? error.message
              : "Could not refresh media processing.",
          );
      } finally {
        loading = false;
      }
    }
    void load();
    const timer = setInterval(() => void load(), 3000);
    const changed = () => {
      setExpanded(true);
      setOffset(0);
      void load();
    };
    window.addEventListener(MEDIA_PROCESSING_EVENT, changed);
    return () => {
      controller.abort();
      clearInterval(timer);
      window.removeEventListener(MEDIA_PROCESSING_EVENT, changed);
    };
  }, [accountFetch, offset, revision]);
  if (!error && offset === 0 && (!page || !page.requests.length)) return null;
  const count = page?.activeCount ?? page?.requests.filter(active).length ?? 0;
  return (
    <section
      className="workspace-exports workspace-media layer-editor"
      aria-label="Media processing"
    >
      <div className="panel-heading">
        <h2>Media processing</h2>
        <p role="status" aria-label="Media processing activity">
          {count
            ? `${count} in progress`
            : error
              ? "Status unavailable"
              : "Recent requests"}
        </p>
        <button
          type="button"
          className="subtle"
          aria-expanded={expanded}
          aria-controls="media-processing-requests"
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? "Hide details" : "Show details"}
        </button>
        <button
          type="button"
          className="subtle"
          aria-label="Refresh media processing"
          disabled={!!pending}
          onClick={() => setRevision((value) => value + 1)}
        >
          Refresh
        </button>
      </div>
      {error && (
        <p role="alert">
          {error} Keep your file or recording; accepted requests can continue in
          the background.
        </p>
      )}
      {expanded && (
        <div id="media-processing-requests">
          <p>
            You can keep editing while files are prepared. Cancelling a
            completed request keeps its media.
          </p>
          <ul>
            {page?.requests.map((request) => {
              const target =
                request.operation === "import"
                  ? request.resultId
                  : request.projectId;
              return (
                <li key={request.id} data-media-request={request.id}>
                  <div>
                    <strong>
                      {request.operation === "import"
                        ? "Project import"
                        : request.operation === "waveform"
                          ? "Audio waveform"
                          : "Media upload"}
                    </strong>
                    <p>
                      {label(request)} ·{" "}
                      <time dateTime={request.createdAt}>
                        {new Date(request.createdAt).toLocaleString()}
                      </time>
                    </p>
                    {request.state === "failed" && (
                      <p>
                        {request.error === "STORAGE_LIMIT"
                          ? "The processed file exceeds the studio allowance. Try a smaller file."
                          : request.error === "SERVICE_STORAGE_LIMIT"
                            ? "Shared media storage is full. Keep the original file and contact the studio operator, or retry after storage is available."
                            : request.error === "PROJECT_DATA_LIMIT"
                              ? "The retained project allowance is full. Keep the file and manage saved history, remove an unneeded project, or contact the operator before retrying."
                              : request.error === "PROJECT_UNAVAILABLE"
                                ? "This project's processing request is no longer available."
                                : "Keep the original file and retry from the upload or import control."}
                      </p>
                    )}
                  </div>
                  <div className="layer-fields">
                    {request.state === "completed" && target && (
                      <button
                        type="button"
                        className="subtle"
                        disabled={disabled || !!pending}
                        aria-label={`Open ${request.operation === "import" ? "imported" : "media"} project`}
                        onClick={() => void onOpen(target)}
                      >
                        Open project
                      </button>
                    )}
                    {active(request) && (
                      <button
                        type="button"
                        className="subtle"
                        disabled={!!pending || request.state === "cancelling"}
                        aria-label="Cancel media processing"
                        onClick={async () => {
                          setPending(request.id);
                          setError("");
                          try {
                            const response = await accountFetch(
                              `/api/media-requests/${request.id}/cancel`,
                              {
                                method: "POST",
                                signal: AbortSignal.timeout(10000),
                              },
                            );
                            const result = await response.json();
                            if (!response.ok)
                              throw new Error(
                                result.error ||
                                  "Could not cancel this request. Refresh to check its status.",
                              );
                            setPage((previous) =>
                              previous
                                ? {
                                    ...previous,
                                    requests: previous.requests.map((item) =>
                                      item.id === request.id
                                        ? result.request
                                        : item,
                                    ),
                                  }
                                : previous,
                            );
                            setRevision((value) => value + 1);
                          } catch (error) {
                            setError(
                              error instanceof Error
                                ? error.message
                                : "Could not cancel this request. Refresh to check its status.",
                            );
                          } finally {
                            setPending(null);
                          }
                        }}
                      >
                        {request.state === "cancelling"
                          ? "Cancelling…"
                          : "Cancel"}
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
          {(offset > 0 || typeof page?.nextOffset === "number") && (
            <div className="layer-fields">
              {offset > 0 && (
                <button
                  type="button"
                  className="subtle"
                  disabled={!!pending}
                  onClick={() => setOffset((value) => Math.max(0, value - 20))}
                >
                  Newer requests
                </button>
              )}
              {page?.nextOffset !== null && page?.nextOffset !== undefined && (
                <button
                  type="button"
                  className="subtle"
                  disabled={!!pending}
                  onClick={() => setOffset(page.nextOffset!)}
                >
                  Older requests
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
