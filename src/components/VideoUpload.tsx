"use client";
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
          if (!(file instanceof File) || file.size > 25 * 1024 * 1024)
            throw new Error("Choose a video up to 25 MB.");
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
        Up to 25 MB / 120 seconds. Clips are checked and converted to 30 fps
        H.264; source audio is retained. Preparing a clip may take up to two
        minutes.
      </p>
      {error && <p role="alert">{error}</p>}
    </form>
  );
}
