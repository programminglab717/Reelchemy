"use client";
import { useMediaSubmission } from "./useMediaSubmission";
import { useState } from "react";
import { isFontMime, type Project } from "@/lib/schema";
import { FontPreview } from "./FontPreview";
import type { AssetUpdate } from "@/lib/project-assets";
import { VideoUpload } from "./VideoUpload";
import { NarrationRecorder } from "./NarrationRecorder";
import { MediaStorage } from "./MediaStorage";
import { StudioMediaLibrary } from "./StudioMediaLibrary";
export function AssetPanel({
  project,
  onProject,
  onAdd,
  onRecordingPending,
  onRecordingActive,
  onRecordStart,
  canAddVisual,
  onUseFont,
}: {
  project: Pick<Project, "id" | "assets" | "timeline">;
  onProject: (p: AssetUpdate) => void;
  onAdd: (id: string) => void;
  onRecordingPending: (pending: boolean) => void;
  onRecordingActive?: (active: boolean) => void;
  onRecordStart: () => void;
  canAddVisual: boolean;
  // Applies an uploaded font to the selected scene's text layers.
  onUseFont?: (id: string) => void;
}) {
  const imageUpload = useMediaSubmission(`/api/projects/${project.id}/assets`);
  const audioUpload = useMediaSubmission(`/api/projects/${project.id}/assets`);
  const fontUpload = useMediaSubmission(`/api/projects/${project.id}/assets`);
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <section id="studio-tool-media" tabIndex={-1} className="layer-editor">
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
        notes={(project.timeline?.scenes || []).map((scene, index, scenes) => ({
          id: scene.id,
          title: scene.title,
          text: scene.intent,
          durationFrames: scene.durationFrames,
          startFrame: scenes
            .slice(0, index)
            .reduce((frames, prior) => frames + prior.durationFrames, 0),
        }))}
        projectId={project.id}
        onProject={onProject}
        onPendingChange={onRecordingPending}
        onActiveChange={onRecordingActive}
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
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          const form = e.currentTarget;
          try {
            const body = new FormData(form);
            body.set("kind", "font");
            const data = await fontUpload.submit(body);
            onProject(data);
            form.reset();
          } catch (e) {
            setError(e instanceof Error ? e.message : "Font upload failed");
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="layer-fields">
          <label>
            Brand font (TTF, OTF, WOFF, WOFF2)
            <input
              aria-label="Upload font"
              disabled={busy}
              type="file"
              name="file"
              accept=".ttf,.otf,.woff,.woff2,font/ttf,font/otf,font/woff,font/woff2"
              required
            />
          </label>
          <label>
            Font license
            <input
              name="license"
              placeholder="Licensed for video use"
              disabled={busy}
              minLength={3}
              maxLength={500}
              required
            />
          </label>
          <button className="subtle" disabled={busy}>
            {busy
              ? fontUpload.message || "Preparing media…"
              : "Upload brand font"}
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
            ) : isFontMime(a.mime) ? (
              <FontPreview
                id={a.id}
                src={`/api/projects/${project.id}/assets/${a.id}`}
                name={a.name}
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
            {isFontMime(a.mime) && onUseFont && (
              <button className="subtle" onClick={() => onUseFont(a.id)}>
                Use for text in selected scene
              </button>
            )}
            {a.mime !== "audio/wav" && !isFontMime(a.mime) && (
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
