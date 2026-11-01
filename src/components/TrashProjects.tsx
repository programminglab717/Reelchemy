"use client";
import { useAccountFetch } from "./AccountBoundary";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { ProjectSummary } from "@/lib/schema";
import { DeleteProjectDialog } from "./DeleteProjectDialog";
import { ProjectDeletions } from "./ProjectDeletions";
export function TrashProjects({ userId }: { userId: string }) {
  const accountFetch = useAccountFetch();
  const [query, setQuery] = useState("");
  const [page, setPage] = useState<{
    query: string;
    projects: ProjectSummary[];
    next: number | null;
    count: number;
  } | null>(null);
  const [revision, setRevision] = useState(0),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const generation = useRef(0);
  const [deleting, setDeleting] = useState<ProjectSummary | null>(null);
  const [notice, setNotice] = useState("");
  useEffect(() => {
    const current = ++generation.current,
      controller = new AbortController();
    const timer = setTimeout(
      () => {
        void accountFetch(
          `/api/projects?trashed=true&limit=20&q=${encodeURIComponent(query)}&view=summary`,
          { signal: controller.signal },
        )
          .then(async (response) => {
            const projects = await response.json();
            if (!response.ok)
              throw new Error(projects.error || "Could not load Trash.");
            if (!controller.signal.aborted && current === generation.current)
              setPage({
                query,
                projects,
                next: response.headers.has("X-Next-Offset")
                  ? Number(response.headers.get("X-Next-Offset"))
                  : null,
                count: Number(response.headers.get("X-Total-Count") || 0),
              });
          })
          .catch((e) => {
            if (!controller.signal.aborted) setError(e.message);
          });
      },
      query ? 250 : 0,
    );
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, revision, accountFetch]);
  return (
    <main className="trash-page">
      <Link href="/" className="subtle">
        ← Back to studio
      </Link>
      <h1>Trash</h1>
      <p>
        Projects here are hidden from the studio, and their active exports are
        cancelled. Restore brings back saved versions, media and finished
        exports. Projects stay here and use storage until you restore them or
        deliberately delete them permanently.
      </p>
      {notice && <p role="status">{notice}</p>}
      <ProjectDeletions refreshKey={revision} />
      {deleting && (
        <DeleteProjectDialog
          key={deleting.id}
          project={deleting}
          userId={userId}
          onClose={() => {
            setDeleting(null);
            setRevision((n) => n + 1);
          }}
          onRequested={(message) => {
            setNotice(message);
            setRevision((n) => n + 1);
          }}
        />
      )}
      <label>
        Find a trashed project
        <input
          aria-label="Search Trash"
          type="search"
          value={query}
          maxLength={100}
          onChange={(e) => {
            setQuery(e.target.value);
            setError("");
          }}
        />
      </label>
      {page?.query !== query ? (
        <p role="status">
          {error ? "Trash could not be loaded." : "Loading Trash…"}
        </p>
      ) : (
        <>
          <p>
            {page.count} {page.count === 1 ? "project" : "projects"} in Trash
          </p>
          {page.projects.length ? (
            <ul>
              {page.projects.map((project) => (
                <li key={project.id}>
                  <div>
                    <h2>{project.name}</h2>
                    <p>
                      {project.trashedAt
                        ? `Moved to Trash ${new Date(project.trashedAt).toLocaleString()}`
                        : ""}
                    </p>
                    <small>{project.revisionCount} saved versions</small>
                  </div>
                  <button
                    type="button"
                    className="subtle"
                    aria-label={`Restore ${project.name}`}
                    disabled={busy}
                    onClick={async () => {
                      setBusy(true);
                      setError("");
                      try {
                        const response = await accountFetch(
                          `/api/projects/${project.id}/trash`,
                          { method: "POST" },
                        );
                        const result = await response.json();
                        if (!response.ok)
                          throw new Error(result.error || "Restore failed.");
                        setRevision((n) => n + 1);
                      } catch (e) {
                        setError((e as Error).message);
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    Restore project
                  </button>
                  <button
                    type="button"
                    className="subtle"
                    disabled={busy}
                    aria-label={`Permanently delete ${project.name}`}
                    onClick={() => setDeleting(project)}
                  >
                    Delete permanently
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p>
              {query
                ? "No trashed projects match this name."
                : "Trash is empty."}
            </p>
          )}
          {page.next !== null && (
            <button
              className="subtle"
              disabled={busy}
              onClick={async () => {
                const current = generation.current;
                setBusy(true);
                setError("");
                try {
                  const response = await accountFetch(
                    `/api/projects?trashed=true&limit=20&offset=${page.next}&q=${encodeURIComponent(query)}&view=summary`,
                  );
                  const projects = await response.json();
                  if (!response.ok)
                    throw new Error(projects.error || "Could not load Trash.");
                  if (current === generation.current)
                    setPage(
                      (old) =>
                        old && {
                          ...old,
                          projects: [
                            ...new Map(
                              [...old.projects, ...projects].map((p) => [
                                p.id,
                                p,
                              ]),
                            ).values(),
                          ],
                          next: response.headers.has("X-Next-Offset")
                            ? Number(response.headers.get("X-Next-Offset"))
                            : null,
                        },
                    );
                } catch (e) {
                  if (current === generation.current)
                    setError((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              Load more trashed projects
            </button>
          )}
        </>
      )}
      {error && (
        <div>
          <button
            className="subtle"
            disabled={busy}
            onClick={() => {
              setError("");
              setRevision((n) => n + 1);
            }}
          >
            Reload Trash
          </button>
          <p role="alert" aria-label="Trash error">
            {error}
          </p>
        </div>
      )}
    </main>
  );
}
