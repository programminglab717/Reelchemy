"use client";
import { useEffect, useState } from "react";
import type { ActiveStudioExport, RenderJob } from "@/lib/schema";
type Queue = { limit: number; exports: ActiveStudioExport[] };
export function WorkspaceExports({
  refreshKey,
  disabled,
  onOpen,
  onJob,
}: {
  refreshKey: string;
  disabled: boolean;
  onOpen: (projectId: string) => Promise<void>;
  onJob: (job: RenderJob) => void;
}) {
  const [queue, setQueue] = useState<Queue | null>(null);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const [pending, setPending] = useState<string | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    let loading = false;
    async function load() {
      if (loading) return;
      loading = true;
      try {
        const response = await fetch("/api/workspace/exports", {
          cache: "no-store",
          signal: AbortSignal.any([
            controller.signal,
            AbortSignal.timeout(10000),
          ]),
        });
        const result = await response.json();
        if (!response.ok)
          throw new Error(result.error || "Could not load Studio exports.");
        if (!controller.signal.aborted) {
          setQueue(result);
          setError("");
        }
      } catch (e) {
        if (!controller.signal.aborted)
          setError(
            e instanceof Error
              ? e.message
              : "Could not refresh Studio exports.",
          );
      } finally {
        loading = false;
      }
    }
    void load();
    const timer = setInterval(() => void load(), 3000);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [revision, refreshKey]);
  return (
    <section
      className="workspace-exports layer-editor"
      aria-label="Studio exports"
    >
      <div className="panel-heading">
        <h2>Studio exports</h2>
        <p role="status" aria-label="Studio export usage">
          {queue
            ? `${queue.exports.length} of ${queue.limit} active exports`
            : error
              ? "Studio exports unavailable."
              : "Loading Studio exports…"}
        </p>
        <button
          type="button"
          className="subtle"
          aria-label="Refresh Studio exports"
          disabled={!!pending}
          onClick={() => {
            setError("");
            setRevision((n) => n + 1);
          }}
        >
          Refresh
        </button>
      </div>
      {queue?.exports.length ? (
        <ul>
          {queue.exports.map((job) => (
            <li key={job.id}>
              <div>
                <strong>{job.projectName}</strong>
                <p>
                  {job.status === "queued"
                    ? "Queued"
                    : `${job.stage || "Rendering"} · ${Math.round(Math.min(1, Math.max(0, job.progress)) * 100)}%`}
                </p>
              </div>
              <div className="layer-fields">
                <button
                  type="button"
                  className="subtle"
                  disabled={disabled || !!pending}
                  aria-label={`Open export project ${job.projectName}`}
                  onClick={() => void onOpen(job.projectId)}
                >
                  Open project
                </button>
                <button
                  type="button"
                  className="subtle"
                  disabled={disabled || !!pending}
                  aria-label={`Cancel export ${job.projectName}`}
                  onClick={async () => {
                    setPending(job.id);
                    setError("");
                    try {
                      const response = await fetch(`/api/jobs/${job.id}`, {
                        method: "DELETE",
                      });
                      const result = await response.json();
                      if (!response.ok)
                        throw new Error(
                          result.error || "Could not cancel this export.",
                        );
                      onJob(result);
                      setQueue((old) =>
                        old
                          ? {
                              ...old,
                              exports: old.exports.filter(
                                (item) => item.id !== job.id,
                              ),
                            }
                          : old,
                      );
                      setRevision((n) => n + 1);
                    } catch (e) {
                      setError(
                        e instanceof Error
                          ? e.message
                          : "Could not cancel this export.",
                      );
                    } finally {
                      setPending(null);
                    }
                  }}
                >
                  {pending === job.id ? "Cancelling…" : "Cancel export"}
                </button>
              </div>
            </li>
          ))}
        </ul>
      ) : null}
      {error && (
        <p role="alert" aria-label="Studio exports error">
          {error} Use Refresh to try again.
        </p>
      )}
      {!!queue?.exports.length && (
        <small>
          Queued and rendering videos count toward your studio limit. Finished
          exports stay in each project’s export history.
        </small>
      )}
    </section>
  );
}
