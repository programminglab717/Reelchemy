"use client";
import { useAccountFetch } from "./AccountBoundary";
import { useEffect, useRef, useState } from "react";
import type { ProjectSummary } from "@/lib/schema";
import { clearProjectBrowserDrafts } from "@/lib/browser-drafts";

export function DeleteProjectDialog({
  project,
  userId,
  onClose,
  onRequested,
}: {
  project: ProjectSummary;
  userId: string;
  onClose: () => void;
  onRequested: (message: string) => void;
}) {
  const accountFetch = useAccountFetch();
  const dialog = useRef<HTMLDialogElement>(null);
  const [confirmation, setConfirmation] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);
  return (
    <dialog
      ref={dialog}
      className="delete-project-dialog"
      aria-labelledby="delete-project-title"
      aria-describedby="delete-project-description"
      onCancel={(e) => {
        e.preventDefault();
        if (!pending) onClose();
      }}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (pending || confirmation !== "DELETE") return;
          setPending(true);
          setError("");
          void (async () => {
            try {
              const response = await accountFetch(
                `/api/projects/${project.id}/deletion`,
                {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ confirmation }),
                  signal: AbortSignal.timeout(15000),
                },
              );
              const result = await response.json();
              if (!response.ok)
                throw new Error(
                  result.error || "Could not request project removal.",
                );
              let message =
                "Permanent removal requested. Storage is freed when cleanup finishes.";
              try {
                clearProjectBrowserDrafts(
                  window.localStorage,
                  userId,
                  project.id,
                );
              } catch {
                message +=
                  " This browser could not clear its recovery copies; clear this site's data on this device when you are done.";
              }
              onRequested(message);
              onClose();
            } catch (error) {
              setError(
                error instanceof Error
                  ? error.message
                  : "Could not request project removal.",
              );
            } finally {
              setPending(false);
            }
          })();
        }}
      >
        <h2 id="delete-project-title">Permanently delete “{project.name}”?</h2>
        <p id="delete-project-description">
          This removes the project’s saved versions, uploaded media and exports
          from the active studio. Media still used by another project stays
          available there. This cannot be undone here.
        </p>
        <p>
          Recovery copies for this project in this browser will be cleared.
          Older backups, downloaded copies and copies on other devices are
          managed separately. Removal may take a little time.
        </p>
        <p>
          {project.revisionCount} saved{" "}
          {project.revisionCount === 1 ? "version" : "versions"} will be
          removed.
        </p>
        <label>
          Type DELETE to confirm
          <input
            autoComplete="off"
            aria-label="Confirm permanent project deletion"
            value={confirmation}
            maxLength={6}
            disabled={pending}
            onChange={(e) => setConfirmation(e.target.value)}
          />
        </label>
        {error && <p role="alert">{error}</p>}
        <div className="dialog-actions">
          <button
            type="button"
            className="subtle"
            disabled={pending}
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            type="submit"
            className="delete-project-confirm"
            disabled={pending || confirmation !== "DELETE"}
          >
            {pending ? "Requesting removal…" : "Delete permanently"}
          </button>
        </div>
      </form>
    </dialog>
  );
}
