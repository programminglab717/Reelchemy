"use client";
import { useState } from "react";
import type { Project } from "@/lib/schema";
export function AssetPanel({
  project,
  onProject,
  onAdd,
}: {
  project: Project;
  onProject: (p: Project) => void;
  onAdd: (id: string) => void;
}) {
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <section className="layer-editor">
      <h2>Project assets</h2>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          const form = e.currentTarget;
          try {
            const response = await fetch(`/api/projects/${project.id}/assets`, {
              method: "POST",
              body: new FormData(form),
            });
            const data = await response.json();
            if (!response.ok) throw new Error(data.error);
            onProject({ ...project, assets: data.assets });
            form.reset();
          } catch (e) {
            setError(e instanceof Error ? e.message : "Upload failed");
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="layer-fields">
          <label>
            PNG / JPEG image
            <input
              aria-label="Upload image"
              type="file"
              name="file"
              accept="image/png,image/jpeg"
              required
            />
          </label>
          <label>
            Source / usage rights
            <input
              name="license"
              placeholder="I own this image"
              minLength={3}
              maxLength={500}
              required
            />
          </label>
          <button className="subtle" disabled={busy}>
            {busy ? "Uploading…" : "Upload asset"}
          </button>
        </div>
      </form>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          const form = e.currentTarget;
          try {
            const body = new FormData(form);
            body.set("kind", "audio");
            const r = await fetch(`/api/projects/${project.id}/assets`, {
              method: "POST",
              body,
            });
            const data = await r.json();
            if (!r.ok) throw new Error(data.error);
            onProject({ ...project, assets: data.assets });
            form.reset();
          } catch (e) {
            setError(e instanceof Error ? e.message : "Audio upload failed");
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="layer-fields">
          <label>
            Audio file
            <input
              aria-label="Upload audio"
              type="file"
              name="file"
              accept="audio/wav,audio/mpeg,audio/ogg,audio/flac,audio/aac"
              required
            />
          </label>
          <label>
            Source / usage rights
            <input
              name="license"
              placeholder="I own this audio"
              minLength={3}
              maxLength={500}
              required
            />
          </label>
          <button className="subtle" disabled={busy}>
            Upload audio asset
          </button>
        </div>
      </form>
      <div className="asset-grid">
        {(project.assets || []).map((a) => (
          <div key={a.id}>
            {a.mime === "audio/wav" ? (
              <audio
                controls
                preload="none"
                src={`/api/projects/${project.id}/assets/${a.id}`}
              />
            ) : (
              <img
                width={100}
                height={70}
                style={{ objectFit: "contain" }}
                src={`/api/projects/${project.id}/assets/${a.id}`}
                alt={a.name}
              />
            )}
            <p>{a.name}</p>
            <small>{a.license}</small>
            {a.mime === "image/png" && (
              <button
                className="subtle"
                disabled={project.timeline?.scenes.some(
                  (s) => s.layers.length >= 20,
                )}
                onClick={() => onAdd(a.id)}
              >
                Add to selected scene
              </button>
            )}
          </div>
        ))}
      </div>
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
