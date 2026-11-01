"use client";
import { useMediaSubmission } from "./useMediaSubmission";
import { useState } from "react";
import type { Project } from "@/lib/schema";
import { VideoUpload } from "./VideoUpload";
import { NarrationRecorder } from "./NarrationRecorder";
import { MediaStorage } from "./MediaStorage";
import { StudioMediaLibrary } from "./StudioMediaLibrary";
export function AssetPanel({
  project,
  onProject,
  onAdd,
  onRecordingPending,
  onRecordStart,
  canAddVisual,
}: {
  project: Project;
  onProject: (p: Project) => void;
  onAdd: (id: string) => void;
  onRecordingPending: (pending: boolean) => void;
  onRecordStart: () => void;
  canAddVisual: boolean;
}) {
  const imageUpload = useMediaSubmission(`/api/projects/${project.id}/assets`);
  const audioUpload = useMediaSubmission(`/api/projects/${project.id}/assets`);
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <section className="layer-editor">
      <h2>Project assets</h2>
      <MediaStorage
        projectId={project.id}
        assetCount={project.assets?.length || 0}
      />
      <StudioMediaLibrary
        key={project.id}
        project={project}
        onProject={onProject}
      />
      <NarrationRecorder
        projectId={project.id}
        onProject={onProject}
        onPendingChange={onRecordingPending}
        onStart={onRecordStart}
      />
      <VideoUpload projectId={project.id} onProject={onProject} />
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          const form = e.currentTarget;
          try {
            const data = await imageUpload.submit(new FormData(form));
            onProject(data);
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
              disabled={busy}
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
              disabled={busy}
              minLength={3}
              maxLength={500}
              required
            />
          </label>
          <button className="subtle" disabled={busy}>
            {busy ? imageUpload.message || "Preparing media…" : "Upload asset"}
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
            const data = await audioUpload.submit(body);
            onProject(data);
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
              disabled={busy}
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
              disabled={busy}
              minLength={3}
              maxLength={500}
              required
            />
          </label>
          <button className="subtle" disabled={busy}>
            {busy
              ? audioUpload.message || "Preparing media…"
              : "Upload audio asset"}
          </button>
        </div>
      </form>
      <div className="asset-grid">
        {(project.assets || []).map((a) => (
          <div key={a.id}>
            {a.mime === "video/mp4" ? (
              <video
                controls
                preload="metadata"
                width={180}
                src={`/api/projects/${project.id}/assets/${a.id}`}
              />
            ) : a.mime === "audio/wav" ? (
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
            {a.mime !== "audio/wav" && (
              <button
                className="subtle"
                disabled={!canAddVisual}
                onClick={() => onAdd(a.id)}
              >
                {a.mime === "video/mp4"
                  ? "Add video to selected scene"
                  : "Add to selected scene"}
              </button>
            )}
          </div>
        ))}
      </div>
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
