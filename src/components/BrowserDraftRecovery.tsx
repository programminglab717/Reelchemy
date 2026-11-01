"use client";
import type { BrowserDraft } from "@/lib/browser-drafts";

export function downloadDraft(value: unknown, name: string) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function BrowserDraftRecovery({
  drafts,
  currentRevisionId,
  disabled,
  onRecover,
  onDiscard,
}: {
  drafts: BrowserDraft[];
  currentRevisionId: string | null;
  disabled: boolean;
  onRecover: (draft: BrowserDraft) => void;
  onDiscard: (draft: BrowserDraft) => void;
}) {
  if (!drafts.length) return null;
  return (
    <section className="save-warning" aria-label="Browser recovery drafts">
      <h2>Unsaved edits found in this browser</h2>
      <p>
        Review a recovery copy before using it. Recovering loads it as an edit
        and autosaves a new version; your saved versions stay available. Copies
        from other tabs are kept separately.
      </p>
      {disabled && (
        <p>Save your current edits before recovering another draft.</p>
      )}
      {drafts.map((draft) => (
        <div key={draft.id}>
          <h3>{draft.timeline.scenes[0]?.title || "Untitled timeline"}</h3>
          <p>
            Recovery copy from {new Date(draft.updatedAt).toLocaleString()}
            {draft.baseRevisionId !== currentRevisionId
              ? " · based on an earlier saved version"
              : ""}
          </p>
          <button
            className="subtle"
            disabled={disabled}
            onClick={() => {
              if (
                draft.baseRevisionId !== currentRevisionId &&
                !window.confirm(
                  "This recovery copy was based on an earlier saved version. Load its timeline as a new edit? Current saved versions remain in version history.",
                )
              )
                return;
              onRecover(draft);
            }}
          >
            Recover draft
          </button>
          <button
            className="subtle"
            onClick={() =>
              downloadDraft(draft, `reelchemy-recovery-${draft.projectId}.json`)
            }
          >
            Download recovery copy
          </button>
          <button
            className="subtle"
            disabled={disabled}
            onClick={() => {
              if (
                window.confirm(
                  "Discard this browser recovery copy? Download it first if you want to keep it. Saved project versions will remain.",
                )
              )
                onDiscard(draft);
            }}
          >
            Discard recovery copy
          </button>
        </div>
      ))}
      <small>
        Recovery copies stay on this device until saved, discarded, or you sign
        out. They do not contain uploaded media or microphone takes. Use a
        private browser profile on shared devices.
      </small>
    </section>
  );
}
