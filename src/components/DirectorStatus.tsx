"use client";
import type { DirectorJobView } from "./useDirector";

// Progress of the AI director's run, or the outcome of the last one.
export function DirectorStatus({
  job,
  onCancel,
  onDismiss,
}: {
  job: DirectorJobView;
  onCancel: () => void;
  onDismiss: () => void;
}) {
  const active = job.state === "queued" || job.state === "working";
  const percent = Math.round(job.progress * 100);
  return (
    <section
      className="director-status"
      role={active ? "status" : job.state === "failed" ? "alert" : "status"}
      aria-label="AI director progress"
    >
      <div className="director-status-head">
        <strong>
          {active
            ? job.request.kind === "scene-revision"
              ? "The director is revising this scene"
              : "The director is animating your film"
            : job.state === "completed"
              ? "The director finished"
              : job.state === "cancelled"
                ? "The director was stopped"
                : "The director could not finish"}
        </strong>
        {active ? (
          <button type="button" className="subtle" onClick={onCancel}>
            Stop
          </button>
        ) : (
          <button type="button" className="subtle" onClick={onDismiss}>
            Dismiss
          </button>
        )}
      </div>
      {active && (
        <>
          <p>{job.stage || "Starting"}…</p>
          <div
            className="director-progress"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percent}
            aria-label="Director progress"
          >
            <span style={{ width: `${Math.max(3, percent)}%` }} />
          </div>
          <small>
            Planning, writing and test-rendering each scene takes a few minutes.
            You can keep working; the new version replaces the current film when
            it is ready.
          </small>
        </>
      )}
      {job.state === "completed" && job.summary && <p>{job.summary}</p>}
      {job.state === "failed" && job.error && <p>{job.error}</p>}
    </section>
  );
}
