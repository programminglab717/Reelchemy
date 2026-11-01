"use client";
import { useMediaSubmission } from "./useMediaSubmission";
import { useRef, useState } from "react";
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
