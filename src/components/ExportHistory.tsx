"use client";
import { useEffect, useState } from "react";
import type { RenderJob } from "@/lib/schema";
export function ExportHistory({
  projectId,
  current,
  onSelect,
}: {
  projectId: string;
  current: RenderJob | null;
  onSelect: (job: RenderJob) => void;
}) {
  const [jobs, setJobs] = useState<RenderJob[]>([]),
    [error, setError] = useState("");
  useEffect(() => {
    let alive = true;
    fetch(`/api/projects/${projectId}/render`)
      .then(async (r) => {
        if (!r.ok) throw new Error("Could not load exports.");
        return r.json();
      })
      .then((data) => {
        if (alive) setJobs(data);
      })
      .catch((e) => {
        if (alive) setError(e.message);
      });
    return () => {
      alive = false;
    };
  }, [projectId, current?.id, current?.status]);
  return (
    <section className="layer-editor">
      <h2>Export history</h2>
      {error && <p role="alert">{error}</p>}
      {jobs.length ? (
        <div className="layer-fields">
          {jobs.map((j) => (
            <button className="subtle" key={j.id} onClick={() => onSelect(j)}>
              {j.createdAt.slice(0, 16).replace("T", " ")} UTC · {j.status} ·{" "}
              {j.id.slice(0, 6)}
            </button>
          ))}
        </div>
      ) : (
        <p>No exports yet.</p>
      )}
    </section>
  );
}
export function QualityEvidence({ job }: { job: RenderJob }) {
  const qc = (
    job.report as {
      qc?: {
        samples?: { sceneId: string; file: string; frame: number }[];
        layout?: { before: unknown[]; changes: unknown[] };
      };
    } | null
  )?.qc;
  const sceneIds = [...new Set(qc?.samples?.map((s) => s.sceneId) || [])];
  return (
    <details className="quality-evidence">
      <summary>Quality report & scene evidence</summary>
      <a
        className="subtle"
        href={`/api/jobs/${job.id}/evidence/report.json`}
        target="_blank"
        rel="noreferrer"
      >
        Open QC report ↗
      </a>
      {job.issues.map((i, n) => (
        <p key={n}>
          {i.severity}: {i.message}
        </p>
      ))}
      {qc?.layout && (
        <p>
          {qc.layout.before.length} initial text issues ·{" "}
          {qc.layout.changes.length} font adjustments. Layout checks do not
          assess storytelling or motion quality.
        </p>
      )}
      {sceneIds.map((id, index) => (
        <section key={id}>
          <h3>Scene {index + 1}</h3>
          <div className="evidence-grid">
            {qc?.samples
              ?.filter((s) => s.sceneId === id)
              .map((s) => (
                <a
                  key={s.file}
                  href={`/api/jobs/${job.id}/evidence/${s.file}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  <img
                    src={`/api/jobs/${job.id}/evidence/${s.file}`}
                    alt={`Scene ${index + 1}, frame ${s.frame}`}
                  />
                  <small>Frame {s.frame}</small>
                </a>
              ))}
          </div>
          <video
            controls
            preload="none"
            src={`/api/jobs/${job.id}/evidence/scene-${index + 1}-motion.mp4`}
            aria-label={`Scene ${index + 1} motion review`}
          />
        </section>
      ))}
    </details>
  );
}
