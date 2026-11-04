"use client";
import { useAccountFetch } from "./AccountBoundary";
import { useEffect, useRef, useState } from "react";
import type { RenderJob } from "@/lib/schema";
import type { ExportPage, ExportSummary } from "@/lib/export-history";
import { Icon } from "./Icon";
type HistoryProps = {
  refreshKey?: number;
  projectId: string;
  current: RenderJob | null;
  onSelect: (job: RenderJob) => void;
};
export function ExportHistory(props: HistoryProps) {
  return <ExportHistoryPage key={props.projectId} {...props} />;
}
function ExportHistoryPage({
  projectId,
  current,
  onSelect,
  refreshKey = 0,
}: HistoryProps) {
  const accountFetch = useAccountFetch();
  const [page, setPage] = useState<ExportPage | null>(null),
    [cursors, setCursors] = useState<(string | null)[]>([null]),
    [pageIndex, setPageIndex] = useState(0),
    [refresh, setRefresh] = useState(0),
    [settled, setSettled] = useState<string | null>(null),
    [opening, setOpening] = useState<string | null>(null),
    [error, setError] = useState("");
  const anchor = useRef<string | null>(null),
    alive = useRef(true),
    selection = useRef<AbortController | null>(null);
  const before = cursors[pageIndex];
  const currentId = current?.projectId === projectId ? current.id : undefined;
  const currentStatus =
    current?.projectId === projectId
      ? `${current.status}:${current.files?.state ?? ""}:${current.retired ? 1 : 0}`
      : undefined;
  const seenCurrent = useRef(`${currentId}:${currentStatus}`);
  const loadKey = JSON.stringify([
    before,
    refresh,
    currentId,
    currentStatus,
    refreshKey,
  ]);
  const loading = settled !== loadKey;
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      selection.current?.abort();
    };
  }, []);
  useEffect(() => {
    let active = true;
    const currentKey = `${currentId}:${currentStatus}`;
    if (seenCurrent.current !== currentKey) {
      seenCurrent.current = currentKey;
      // A new/finished render refreshes the newest page automatically. Older
      // pages retain their anchor until the maker explicitly refreshes.
      if (before === null) anchor.current = null;
    }
    const abort = new AbortController(),
      query = new URLSearchParams({ view: "history" });
    if (anchor.current !== null) query.set("anchor", String(anchor.current));
    if (before !== null) query.set("before", String(before));
    accountFetch(
      `/api/projects/${encodeURIComponent(projectId)}/render?${query}`,
      { signal: AbortSignal.any([abort.signal, AbortSignal.timeout(15000)]) },
    )
      .then(async (response) => {
        if (!response.ok) throw new Error();
        const data: ExportPage = await response.json();
        if (
          !Array.isArray(data.items) ||
          data.items.length > 20 ||
          typeof data.anchor !== "string" ||
          !/^v1\.[A-Za-z0-9_-]{48,60}$/.test(data.anchor) ||
          !Number.isSafeInteger(data.total) ||
          data.total < 0 ||
          !Number.isSafeInteger(data.unavailable) ||
          data.unavailable < 0 ||
          data.unavailable > 20 ||
          data.items.some(
            (job) =>
              !job ||
              typeof job.id !== "string" ||
              !job.id.length ||
              job.id.length > 160 ||
              job.projectId !== projectId ||
              ![
                "queued",
                "rendering",
                "completed",
                "failed",
                "cancelled",
              ].includes(job.status) ||
              (job.createdAt !== null &&
                (typeof job.createdAt !== "string" ||
                  job.createdAt.length > 40)),
          ) ||
          (data.nextBefore !== null &&
            (typeof data.nextBefore !== "string" ||
              !/^v1\.[A-Za-z0-9_-]{48,60}$/.test(data.nextBefore)))
        )
          throw new Error();
        if (active) {
          anchor.current = data.anchor;
          setPage(data);
          setError("");
        }
      })
      .catch(() => {
        if (active)
          setError(
            "Could not load export history. Refresh to retry; your edits are kept here.",
          );
      })
      .finally(() => {
        if (active) setSettled(loadKey);
      });
    return () => {
      active = false;
      abort.abort();
    };
  }, [
    projectId,
    before,
    refresh,
    currentId,
    currentStatus,
    accountFetch,
    loadKey,
  ]);
  async function openExport(summary: ExportSummary) {
    const abort = new AbortController();
    selection.current?.abort();
    selection.current = abort;
    setOpening(summary.id);
    setError("");
    try {
      const response = await accountFetch(
        `/api/jobs/${encodeURIComponent(summary.id)}`,
        { signal: AbortSignal.any([abort.signal, AbortSignal.timeout(15000)]) },
      );
      if (!response.ok) throw new Error();
      const job: RenderJob = await response.json();
      if (
        job.id !== summary.id ||
        job.projectId !== projectId ||
        !["queued", "rendering", "completed", "failed", "cancelled"].includes(
          job.status,
        ) ||
        !Array.isArray(job.issues)
      )
        throw new Error();
      if (alive.current && selection.current === abort) onSelect(job);
    } catch {
      if (alive.current && selection.current === abort)
        setError(
          "Could not open this export. Select it again to retry; your edits are kept here.",
        );
    } finally {
      if (alive.current && selection.current === abort) {
        setOpening(null);
        selection.current = null;
      }
    }
  }
  return (
    <section
      className="layer-editor export-history"
      aria-label="Export history"
      aria-busy={loading || !!opening}
    >
      <h2>Export history</h2>
      <button
        className="subtle"
        disabled={loading || !!opening}
        onClick={() => {
          anchor.current = null;
          setCursors([null]);
          setPageIndex(0);
          setRefresh((value) => value + 1);
        }}
      >
        Refresh export history
      </button>
      {!loading && error && (
        <p role="alert" aria-label="Export history error">
          {error}
        </p>
      )}
      {page?.items.length ? (
        <div className="layer-fields">
          {page.items.map((job) => (
            <button
              className="subtle"
              key={job.id}
              disabled={loading || !!opening}
              onClick={() => void openExport(job)}
            >
              {opening === job.id ? "Opening… " : ""}
              {job.createdAt
                ? `${job.createdAt.slice(0, 16).replace("T", " ")} UTC`
                : "Unknown date"}{" "}
              · {job.status}
              {job.retired ? " · details retired" : ""}
              {job.fileState
                ? ` · files ${job.fileState === "completed" ? "removed" : job.fileState}`
                : ""}{" "}
              · {job.id.slice(0, 6)}
            </button>
          ))}
        </div>
      ) : (
        <p>
          {loading
            ? "Loading exports…"
            : page
              ? "No exports on this page."
              : "Export history is unavailable."}
        </p>
      )}
      {!!page?.unavailable && (
        <p>
          {page.unavailable} unreadable export record(s) on this page. Other
          pages remain available.
        </p>
      )}
      {page && (
        <p>
          {page.total} retained export{page.total === 1 ? "" : "s"}. Open an
          export to view its retained details and downloads.
        </p>
      )}
      {(pageIndex > 0 ||
        (page?.nextBefore !== null && page?.nextBefore !== undefined)) && (
        <div className="layer-fields">
          <button
            className="subtle"
            disabled={loading || !!opening || pageIndex === 0}
            onClick={() => setPageIndex((value) => value - 1)}
          >
            Newer exports
          </button>
          <span>Page {pageIndex + 1}</span>
          <button
            className="subtle"
            disabled={loading || !!opening || page?.nextBefore == null}
            onClick={() => {
              if (page?.nextBefore == null) return;
              setCursors((values) => [
                ...values.slice(0, pageIndex + 1),
                page.nextBefore,
              ]);
              setPageIndex((value) => value + 1);
            }}
          >
            Older exports
          </button>
        </div>
      )}
    </section>
  );
}
export function QualityEvidence({ job }: { job: RenderJob }) {
  const qc = (
    job.report as {
      qc?: {
        samples?: { sceneId: string; file: string; frame: number }[];
        layout?: { before: unknown[]; changes: unknown[] };
      };
    } | null
  )?.qc;
  const sceneIds = [...new Set(qc?.samples?.map((s) => s.sceneId) || [])];
  return (
    <details className="quality-evidence">
      <summary>Quality report & scene evidence</summary>
      {Array.isArray(job.report?.sceneCache) && (
        <p>
          {
            (job.report!.sceneCache as { reused: boolean }[]).filter(
              (s) => s.reused,
            ).length
          }{" "}
          unchanged scene clips reused.
        </p>
      )}
      <a
        className="subtle"
        href={`/api/jobs/${job.id}/evidence/report.json`}
        target="_blank"
        rel="noreferrer"
      >
        Open QC report <Icon name="arrow-up-right" size={14} />
      </a>
      {job.issues.map((i, n) => (
        <p key={n}>
          {i.severity}: {i.message}
        </p>
      ))}
      {qc?.layout && (
        <p>
          {qc.layout.before.length} initial text issues ·{" "}
          {qc.layout.changes.length} font adjustments. Layout checks do not
          assess storytelling or motion quality.
        </p>
      )}
      {sceneIds.map((id, index) => (
        <section key={id}>
          <h3>Scene {index + 1}</h3>
          <div className="evidence-grid">
            {qc?.samples
              ?.filter((s) => s.sceneId === id)
              .map((s) => (
                <a
                  key={s.file}
                  href={`/api/jobs/${job.id}/evidence/${s.file}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  <img
                    src={`/api/jobs/${job.id}/evidence/${s.file}`}
                    alt={`Scene ${index + 1}, frame ${s.frame}`}
                  />
                  <small>Frame {s.frame}</small>
                </a>
              ))}
          </div>
          <video
            controls
            preload="none"
            src={`/api/jobs/${job.id}/evidence/scene-${index + 1}-motion.mp4`}
            aria-label={`Scene ${index + 1} motion review`}
          />
        </section>
      ))}
    </details>
  );
}
