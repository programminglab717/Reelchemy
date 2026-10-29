"use client";
import { useState } from "react";
export function ProjectName({
  name,
  onRename,
}: {
  name: string;
  onRename: (name: string) => Promise<void>;
}) {
  const [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  if (!open)
    return (
      <button className="subtle" onClick={() => setOpen(true)}>
        Rename project
      </button>
    );
  return (
    <form
      className="layer-fields"
      onSubmit={async (e) => {
        e.preventDefault();
        const next = String(
          new FormData(e.currentTarget).get("name") || "",
        ).trim();
        if (!next) return;
        setBusy(true);
        setError("");
        try {
          await onRename(next);
          setOpen(false);
        } catch (e) {
          setError((e as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <label>
        Project name
        <input
          key={name}
          aria-label="Project name"
          name="name"
          defaultValue={name}
          maxLength={100}
          required
          disabled={busy}
          autoFocus
        />
      </label>
      <button className="subtle" disabled={busy}>
        {busy ? "Renaming…" : "Save project name"}
      </button>
      <button
        className="subtle"
        type="button"
        disabled={busy}
        onClick={() => {
          setOpen(false);
          setError("");
        }}
      >
        Cancel rename
      </button>
      {error && (
        <p role="alert" aria-label="Rename error">
          {error}
        </p>
      )}
    </form>
  );
}
