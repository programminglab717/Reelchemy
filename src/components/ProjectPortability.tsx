"use client";
import { useMediaSubmission } from "./useMediaSubmission";
import { useEffect, useRef, useState } from "react";
import { useAccountFetch } from "./AccountBoundary";
import { archiveDownload } from "@/lib/archive-download";
import type { Project } from "@/lib/schema";
export function ImportProject({
  onImport,
}: {
  onImport: (p: Project) => void;
}) {
  const upload = useMediaSubmission("/api/projects/import");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [selected, setSelected] = useState<File | null>(null);
  const input = useRef<HTMLInputElement>(null);
  async function importFile(file: File) {
    setBusy(true);
    setError("");
    try {
      const project = await upload.submit(file);
      if (input.current) input.current.value = "";
      setSelected(null);
      onImport(project);
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError"))
        setError(error instanceof Error ? error.message : "Import failed");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="project-import">
      <label>
        Import a project{" "}
        <input
          aria-label="Import project archive"
          ref={input}
          type="file"
          accept=".zip,application/zip"
          disabled={busy}
          onChange={(e) => {
            const file = e.currentTarget.files?.[0];
            if (!file) return;
            setSelected(file);
            void importFile(file);
          }}
        />
      </label>
      {busy && <span role="status">{upload.message || "Importing…"}</span>}
      {error && <p role="alert">{error}</p>}
      {error && selected && (
        <button
          type="button"
          className="subtle"
          disabled={busy}
          onClick={() => void importFile(selected)}
        >
          Retry import
        </button>
      )}
    </div>
  );
}

export function DownloadProject({
  projectId,
  disabled,
  beforeDownload,
}: {
  projectId: string;
  disabled: boolean;
  beforeDownload: () => Promise<void>;
}) {
  const accountFetch = useAccountFetch();
  const active = useRef<AbortController | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => () => active.current?.abort(), []);
  async function download() {
    if (active.current) return;
    const controller = new AbortController();
    active.current = controller;
    setBusy(true);
    setError("");
    const deadline = setTimeout(
      () =>
        controller.abort(
          new Error(
            "Preparing the archive timed out. Your work is still here; retry the download.",
          ),
        ),
      120000,
    );
    try {
      await beforeDownload();
      controller.signal.throwIfAborted();
      const response = await accountFetch(
        `/api/projects/${encodeURIComponent(projectId)}/archive`,
        { signal: controller.signal },
      );
      const blob = await archiveDownload(response);
      controller.signal.throwIfAborted();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `reelchemy-${projectId}.zip`;
      document.body.append(link);
      link.click();
      link.remove();
      // Keep the URL alive until the browser has consumed the download click.
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (failure) {
      if (
        !controller.signal.aborted ||
        !(controller.signal.reason instanceof DOMException)
      )
        setError(
          failure instanceof Error
            ? failure.message
            : "The editable project could not be downloaded.",
        );
    } finally {
      clearTimeout(deadline);
      if (active.current === controller) {
        active.current = null;
        setBusy(false);
      }
    }
  }
  return (
    <div className="project-download">
      <button
        type="button"
        className="subtle"
        disabled={disabled || busy}
        onClick={() => void download()}
      >
        {busy ? "Preparing editable project…" : "Download editable project"}
      </button>
      {busy && (
        <>
          <span role="status">
            Preparing your saved project. You can keep editing.
          </span>
          <button
            type="button"
            className="subtle"
            onClick={() => active.current?.abort()}
          >
            Cancel download
          </button>
        </>
      )}
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
