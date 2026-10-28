"use client";
import { useState } from "react";
import type { Project } from "@/lib/schema";
export function ImportProject({
  onImport,
}: {
  onImport: (p: Project) => void;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <div className="project-import">
      <label>
        Import a project{" "}
        <input
          aria-label="Import project archive"
          type="file"
          accept=".zip,application/zip"
          disabled={busy}
          onChange={async (e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            setBusy(true);
            setError("");
            try {
              if (file.size > 50 * 1024 * 1024)
                throw new Error("Archives must be 50 MB or smaller.");
              const r = await fetch("/api/projects/import", {
                method: "POST",
                headers: { "content-type": "application/zip" },
                body: file,
              });
              const p = await r.json();
              if (!r.ok) throw new Error(p.error);
              onImport(p);
            } catch (e) {
              setError(e instanceof Error ? e.message : "Import failed");
            } finally {
              setBusy(false);
            }
          }}
        />
      </label>
      {busy && <span>Importing…</span>}
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
