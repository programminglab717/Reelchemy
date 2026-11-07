"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { AccountFetch } from "@/lib/account-fetch";

export type DirectorJobView = {
  id: string;
  projectId: string;
  state: "queued" | "working" | "completed" | "failed" | "cancelled";
  stage: string;
  progress: number;
  error: string | null;
  summary: string | null;
  request: { kind: "film" | "film-revision" | "scene-revision" };
};
export const directorActive = (job: DirectorJobView | null) =>
  !!job && (job.state === "queued" || job.state === "working");

// Tracks the AI director's run for the open project: starts it, polls its
// progress, and reports when a run finishes so the project can be reloaded.
export function useDirector(
  transport: AccountFetch,
  projectId: string | undefined,
  onFinished: (job: DirectorJobView) => void,
) {
  const [job, setJob] = useState<DirectorJobView | null>(null);
  const finished = useRef(onFinished);
  useEffect(() => {
    finished.current = onFinished;
  }, [onFinished]);
  const read = useCallback(
    async (id: string) => {
      const response = await transport(`/api/projects/${id}/direct`, {
        cache: "no-store",
      });
      if (!response.ok) return null;
      return ((await response.json()) as { job: DirectorJobView | null }).job;
    },
    [transport],
  );
  // Resume showing a run in progress when a project opens (or the page reloads).
  useEffect(() => {
    let current = true;
    if (!projectId) return;
    void read(projectId)
      .then((latest) => {
        if (current) setJob(directorActive(latest) ? latest : null);
      })
      .catch(() => {});
    return () => {
      current = false;
    };
  }, [projectId, read]);
  const active = directorActive(job);
  useEffect(() => {
    if (!active || !job) return;
    const timer = setInterval(() => {
      void read(job.projectId)
        .then((latest) => {
          if (!latest || latest.id !== job.id) return;
          setJob(latest);
          if (!directorActive(latest)) finished.current(latest);
        })
        .catch(() => {});
    }, 1500);
    return () => clearInterval(timer);
  }, [active, job, read]);
  const start = useCallback(
    async (
      id: string,
      body: { instruction?: string; sceneId?: string },
    ): Promise<"started" | "needs-key"> => {
      const response = await transport(`/api/projects/${id}/direct`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = await response.json();
      if (response.status === 409 && result.code === "DIRECTOR_NEEDS_KEY")
        return "needs-key";
      if (!response.ok)
        throw new Error(result.error || "The director could not start.");
      setJob(result.job);
      return "started";
    },
    [transport],
  );
  const cancel = useCallback(async () => {
    if (!job) return;
    const response = await transport(`/api/projects/${job.projectId}/direct`, {
      method: "DELETE",
    });
    if (response.ok) setJob((await response.json()).job);
  }, [job, transport]);
  const dismiss = useCallback(() => setJob(null), []);
  return { job, active, start, cancel, dismiss };
}
