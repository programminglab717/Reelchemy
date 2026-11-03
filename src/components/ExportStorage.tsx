"use client";
import { useEffect, useRef, useState } from "react";
import { useAccountFetch } from "./AccountBoundary";
import { ExportFiles } from "./ExportFiles";
import type { ExportStorageUsage } from "@/lib/export-storage-policy";
import type {
  RetainedExport,
  RetainedExportPage,
} from "@/lib/retained-exports";
import type { ExportFileRemoval } from "@/lib/export-file-policy";

const amount = (bytes: number) =>
  bytes >= 1024 ** 3
    ? `${(bytes / 1024 ** 3).toFixed(2)} GB`
    : `${(bytes / 1024 ** 2).toFixed(2)} MB`;
const integer = (value: unknown) =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const token = (value: unknown) =>
  typeof value === "string" && /^v1\.[A-Za-z0-9_-]{48,60}$/.test(value);
export function ExportStorage({
  refreshKey,
  onChange,
}: {
  refreshKey: string;
  onChange: (receipt: ExportFileRemoval) => void;
}) {
  const request = useAccountFetch(),
    dialog = useRef<HTMLDialogElement>(null),
    opener = useRef<HTMLButtonElement>(null);
  const [usage, setUsage] = useState<ExportStorageUsage | null>(null),
    [usageError, setUsageError] = useState(""),
    [refresh, setRefresh] = useState(0),
    [open, setOpen] = useState(false);
  const [page, setPage] = useState<RetainedExportPage | null>(null),
    [cursors, setCursors] = useState<(string | null)[]>([null]),
    [index, setIndex] = useState(0),
    [revision, setRevision] = useState(0),
    [settled, setSettled] = useState(""),
    [error, setError] = useState("");
  const [selected, setSelected] = useState<RetainedExport | null>(null),
    [removal, setRemoval] = useState<ExportFileRemoval | null>(null);
  const anchor = useRef<string | null>(null),
    before = cursors[index],
    loadKey = JSON.stringify([before, revision]);
  const loading = settled !== loadKey;
  useEffect(() => {
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function load() {
      try {
        const response = await request("/api/workspace/export-storage", {
          signal: AbortSignal.any([abort.signal, AbortSignal.timeout(15000)]),
        });
        if (!response.ok) throw new Error();
        const value: ExportStorageUsage = await response.json();
        if (
          !value ||
          ![
            value.usedBytes,
            value.reservedBytes,
            value.limitBytes,
            value.availableBytes,
            value.retainedExports,
            value.pendingExports,
            value.limitExports,
            value.outputCeilingBytes,
          ].every(integer) ||
          value.limitBytes < 1 ||
          value.limitExports < 1 ||
          value.outputCeilingBytes < 1
        )
          throw new Error();
        if (abort.signal.aborted) return;
        setUsage(value);
        setUsageError("");
        if (value.pendingExports > 0)
          timer = setTimeout(() => void load(), 3000);
      } catch {
        if (!abort.signal.aborted)
          setUsageError(
            "Export storage is unavailable. Refresh to retry; you can keep editing.",
          );
      }
    }
    void load();
    return () => {
      abort.abort();
      clearTimeout(timer);
    };
  }, [request, refresh, refreshKey]);
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
          `/api/workspace/export-storage/files?${query}`,
          {
            signal: AbortSignal.any([abort.signal, AbortSignal.timeout(15000)]),
          },
        );
        if (!response.ok) throw new Error();
        const value: RetainedExportPage = await response.json();
        if (
          !value ||
          !Array.isArray(value.items) ||
          value.items.length > 20 ||
          !token(value.anchor) ||
          (value.nextBefore !== null && !token(value.nextBefore)) ||
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
              !integer(item.fileCount) ||
              item.fileCount < 1 ||
              typeof item.inTrash !== "boolean" ||
              typeof item.processing !== "boolean" ||
              !["completed", "failed", "cancelled"].includes(item.status) ||
              (item.fileState !== null &&
                !["queued", "working", "failed", "completed"].includes(
                  item.fileState,
                )),
          )
        )
          throw new Error();
        if (!abort.signal.aborted) {
          anchor.current = value.anchor;
          setPage(value);
          setError("");
        }
      } catch {
        if (!abort.signal.aborted)
          setError(
            "Retained exports could not be loaded. Refresh to retry; your edits are kept.",
          );
      } finally {
        if (!abort.signal.aborted) setSettled(loadKey);
      }
    })();
    return () => abort.abort();
  }, [open, request, before, revision, loadKey]);
  function firstPage() {
    anchor.current = null;
    setCursors([null]);
    setIndex(0);
    setRevision((n) => n + 1);
    setSelected(null);
    setRemoval(null);
  }
  function changed(receipt: ExportFileRemoval) {
    setRemoval(receipt);
    onChange(receipt);
    setRefresh((n) => n + 1);
    if (receipt.state === "completed") {
      anchor.current = null;
      setCursors([null]);
      setIndex(0);
      setRevision((n) => n + 1);
    }
  }
  const full =
    usage &&
    (usage.availableBytes < usage.outputCeilingBytes ||
      usage.retainedExports >= usage.limitExports);
  return (
    <section
      className="export-storage layer-editor"
      aria-label="Studio export storage"
    >
      <div className="panel-heading">
        <h2>Export storage</h2>
        <button className="subtle" onClick={() => setRefresh((n) => n + 1)}>
          Refresh export storage
        </button>
        <button
          className="subtle"
          ref={opener}
          onClick={() => {
            firstPage();
            setOpen(true);
          }}
        >
          Manage export files
        </button>
      </div>
      {usage && (
        <>
          <p role="status" aria-label="Export storage usage">
            {amount(usage.usedBytes)} retained · {amount(usage.reservedBytes)}{" "}
            reserved · {amount(usage.limitBytes)} allowance
          </p>
          <p>
            {usage.retainedExports} of {usage.limitExports} retained exports ·{" "}
            {usage.pendingExports} active reservations. Each new export reserves
            up to {amount(usage.outputCeilingBytes)}.
          </p>
          {full && (
            <p>
              Download files you need, then review older exports to free space
              for another export. Your saved films and original media stay here.
            </p>
          )}
        </>
      )}
      {!usage && !usageError && <p role="status">Loading export storage…</p>}
      {usageError && <p role="alert">{usageError}</p>}
      {open && (
        <dialog
          ref={dialog}
          className="delete-project-dialog export-storage-dialog"
          aria-labelledby="export-storage-title"
          onCancel={() => setOpen(false)}
        >
          <h2 id="export-storage-title">Manage export files</h2>
          <p>
            Review exports from across your studio while keeping your current
            edit open. Download anything you need before removing files.
          </p>
          <div className="dialog-actions">
            <button className="subtle" onClick={firstPage}>
              Refresh retained exports
            </button>
            <button className="subtle" onClick={() => setOpen(false)}>
              Close export manager
            </button>
          </div>
          <div aria-busy={loading}>
            {loading ? (
              <p role="status">Loading retained exports…</p>
            ) : error ? (
              <p role="alert">{error}</p>
            ) : (
              <>
                {!page?.items.length && (
                  <p>No retained export files on this page.</p>
                )}
                <ul className="retained-export-list">
                  {page?.items.map((item) => (
                    <li key={item.id}>
                      <strong>{item.projectName}</strong>
                      <p>
                        {item.status} · {amount(item.bytes)} · {item.fileCount}{" "}
                        files · {item.id.slice(0, 8)}
                      </p>
                      {item.inTrash ? (
                        <p>
                          In Trash. Close this manager and restore the project
                          from Trash to review its files.
                        </p>
                      ) : item.processing ? (
                        <p>
                          Finishing cancellation. Refresh after rendering has
                          stopped.
                        </p>
                      ) : (
                        <button
                          className="subtle"
                          onClick={() => {
                            setSelected(item);
                            setRemoval(null);
                          }}
                        >
                          Review files for export {item.id.slice(0, 8)}
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
                <div className="dialog-actions">
                  <button
                    className="subtle"
                    disabled={index === 0}
                    onClick={() => {
                      setIndex((n) => n - 1);
                      setSelected(null);
                      setRemoval(null);
                    }}
                  >
                    Newer retained exports
                  </button>
                  <button
                    className="subtle"
                    disabled={!page?.nextBefore}
                    onClick={() => {
                      setCursors((old) => [
                        ...old.slice(0, index + 1),
                        page!.nextBefore,
                      ]);
                      setIndex((n) => n + 1);
                      setSelected(null);
                      setRemoval(null);
                    }}
                  >
                    Older retained exports
                  </button>
                </div>
              </>
            )}
          </div>
          {selected && (
            <div className="retained-export-review" key={selected.id}>
              <h3>
                {selected.projectName} · export {selected.id.slice(0, 8)}
              </h3>
              {!removal &&
                !selected.fileState &&
                selected.status === "completed" && (
                  <p>
                    <a
                      href={`/api/jobs/${encodeURIComponent(selected.id)}/download`}
                    >
                      Download MP4 before removal
                    </a>
                  </p>
                )}
              <ExportFiles
                job={{
                  id: selected.id,
                  projectId: selected.projectId,
                  status: selected.status,
                  files:
                    removal ??
                    (selected.fileState
                      ? {
                          jobId: selected.id,
                          projectId: selected.projectId,
                          state: selected.fileState,
                          requestedAt: "",
                          completedAt: null,
                          error:
                            selected.fileState === "failed"
                              ? "Previous cleanup could not finish. Review the current files to retry."
                              : null,
                        }
                      : undefined),
                }}
                onChange={changed}
              />
            </div>
          )}
        </dialog>
      )}
    </section>
  );
}
