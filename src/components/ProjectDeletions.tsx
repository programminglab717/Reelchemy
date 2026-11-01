"use client";
import { useAccountFetch } from "./AccountBoundary";
import { useEffect, useState } from "react";
import type { ProjectDeletion } from "@/lib/project-deletion-store";
type Page = {
  requests: ProjectDeletion[];
  total: number;
  nextOffset: number | null;
};
export function ProjectDeletions({ refreshKey }: { refreshKey: number }) {
  const accountFetch = useAccountFetch();
  const [page, setPage] = useState<Page | null>(null);
  const [offset, setOffset] = useState(0);
  const [revision, setRevision] = useState(0);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    let loading = false;
    async function load() {
      if (loading) return;
      loading = true;
      try {
        const response = await accountFetch(
          `/api/workspace/deletions?offset=${offset}`,
          {
            cache: "no-store",
            signal: AbortSignal.any([
              controller.signal,
              AbortSignal.timeout(10000),
            ]),
          },
        );
        const result: Page & { error?: string } = await response.json();
        if (!response.ok)
          throw new Error(result.error || "Could not check project removals.");
        if (!controller.signal.aborted) {
          if (offset && offset >= result.total) setOffset(0);
          setPage(result);
          setError("");
        }
      } catch (error) {
        if (!controller.signal.aborted)
          setError(
            error instanceof Error
              ? error.message
              : "Could not refresh project removals.",
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
  }, [offset, revision, refreshKey, accountFetch]);
  return (
    <section className="project-deletions" aria-label="Project removals">
      <div className="panel-heading">
        <h2>Project removals</h2>
        <p role="status" aria-label="Project removal status">
          {page
            ? page.total
              ? `${page.total} unfinished ${page.total === 1 ? "removal" : "removals"}`
              : "No pending project removals."
            : error
              ? "Project removals unavailable."
              : "Checking project removals…"}
        </p>
        <button
          type="button"
          className="subtle"
          disabled={!!pending}
          onClick={() => setRevision((n) => n + 1)}
        >
          Refresh removals
        </button>
      </div>
      {!!page?.requests.length && (
        <ul>
          {page.requests.map((item) => (
            <li key={item.projectId}>
              <div>
                <strong>{item.name || "Project"}</strong>
                <p>
                  {item.state === "working"
                    ? "Removing project files…"
                    : item.state === "failed"
                      ? item.error || "Removal needs attention."
                      : "Waiting for cleanup…"}
                </p>
              </div>
              {item.state === "failed" && (
                <button
                  type="button"
                  className="subtle"
                  disabled={!!pending}
                  aria-label={`Retry removal of ${item.name || "project"}`}
                  onClick={async () => {
                    setPending(item.projectId);
                    setError("");
                    try {
                      const response = await accountFetch(
                        `/api/projects/${item.projectId}/deletion`,
                        {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ confirmation: "DELETE" }),
                          signal: AbortSignal.timeout(15000),
                        },
                      );
                      const result = await response.json();
                      if (!response.ok)
                        throw new Error(
                          result.error || "Could not retry project removal.",
                        );
                      setRevision((n) => n + 1);
                    } catch (error) {
                      setError(
                        error instanceof Error
                          ? error.message
                          : "Could not retry project removal.",
                      );
                    } finally {
                      setPending(null);
                    }
                  }}
                >
                  Retry cleanup
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      <div className="dialog-actions">
        {offset > 0 && (
          <button
            type="button"
            className="subtle"
            onClick={() => setOffset(Math.max(0, offset - 20))}
          >
            Previous removals
          </button>
        )}
        {page?.nextOffset !== null && page?.nextOffset !== undefined && (
          <button
            type="button"
            className="subtle"
            onClick={() => setOffset(page.nextOffset!)}
          >
            More removals
          </button>
        )}
      </div>
      {error && (
        <p role="alert" aria-label="Project removals error">
          {error} Use Refresh removals to try again.
        </p>
      )}
      {!!page?.total && (
        <small>
          These projects stay hidden while cleanup finishes. Storage is
          reclaimed afterward. If cleanup fails again, contact the studio
          operator.
        </small>
      )}
    </section>
  );
}
