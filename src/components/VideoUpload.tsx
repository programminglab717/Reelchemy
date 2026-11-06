"use client";
import {
  MAX_MEDIA_UPLOAD_BYTES,
  mediaUploadLimitText,
} from "@/lib/timeline-limits";
import { useMediaSubmission } from "./useMediaSubmission";
import { useState } from "react";
import type { AssetUpdate } from "@/lib/project-assets";
export function VideoUpload({
  projectId,
  onProject,
}: {
  projectId: string;
  onProject: (p: AssetUpdate) => void;
}) {
  const upload = useMediaSubmission(`/api/projects/${projectId}/assets`);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        const form = e.currentTarget;
        setError("");
        setBusy(true);
        try {
          const body = new FormData(form);
          body.set("kind", "video");
          const file = body.get("file");
          if (
            !(file instanceof File) ||
            file.size > MAX_MEDIA_UPLOAD_BYTES.video
          )
            throw new Error(
              `Choose a video up to ${mediaUploadLimitText("video")}.`,
            );
          const data = await upload.submit(body);
          onProject(data);
          form.reset();
        } catch (e) {
          setError(e instanceof Error ? e.message : "Video upload failed.");
        } finally {
          setBusy(false);
        }
      }}
    >
      <div className="layer-fields">
        <label>
          MP4 / MOV / WebM
          <input
            aria-label="Upload video"
            type="file"
            name="file"
            accept="video/mp4,video/quicktime,video/webm"
            required
            disabled={busy}
          />
        </label>
        <label>
          Source / usage rights
          <input
            name="license"
            placeholder="I own this footage"
            minLength={3}
            maxLength={500}
            required
            disabled={busy}
          />
        </label>
        <button className="subtle" disabled={busy}>
          {busy ? upload.message || "Preparing video…" : "Upload video asset"}
        </button>
      </div>
      <p>
        Up to {mediaUploadLimitText("video")} / 5 minutes. Large files upload in
        pieces and resume if the connection drops. Clips are checked and
        converted to 30 fps H.264 (up to 1080p); source audio is retained.
        Preparing a long or 4K clip can take several minutes.
      </p>
      {error && <p role="alert">{error}</p>}
    </form>
  );
}
