"use client";
import { useEffect, useRef, useState } from "react";
import { useAccountFetch } from "./AccountBoundary";
import type { AssetUpdate } from "@/lib/project-assets";
import type {
  LibraryItem,
  LibraryPage,
  LibraryQuery,
} from "@/lib/media-library";

export function StudioMediaLibrary({
  project,
  onProject,
}: {
  project: AssetUpdate;
  onProject: (project: AssetUpdate) => void;
}) {
  const request = useAccountFetch();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<LibraryQuery["kind"]>("all");
  const [page, setPage] = useState<LibraryPage | null>(null);
  const [revision, setRevision] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const generation = useRef(0);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    if (!open) return;
    const version = ++generation.current;
    const controller = new AbortController();
    const timer = setTimeout(
      () => {
        void request(
          `/api/workspace/assets?projectId=${project.id}&q=${encodeURIComponent(query)}&kind=${kind}`,
          {
            signal: AbortSignal.any([
              controller.signal,
              AbortSignal.timeout(10000),
            ]),
          },
        )
          .then(async (response) => {
            const result = await response.json();
            if (!response.ok)
              throw new Error(
                result.error || "The media library could not be loaded.",
              );
            if (!controller.signal.aborted && version === generation.current) {
              setPage(result);
              setError("");
            }
          })
          .catch((error: unknown) => {
            if (!controller.signal.aborted && version === generation.current)
              setError(
                error instanceof Error
                  ? error.message
                  : "The media library could not be loaded.",
              );
          });
      },
      query ? 250 : 0,
    );
    return () => {
      clearTimeout(timer);
      controller.abort();
      generation.current = version + 1;
    };
  }, [open, project.id, query, kind, revision, request]);
  function refresh() {
    setPage(null);
    setError("");
    setRevision((value) => value + 1);
  }
  async function loadMore() {
    if (!page || page.nextOffset === null || loadingMore) return;
    const version = generation.current;
    setLoadingMore(true);
    setError("");
    try {
      const response = await request(
        `/api/workspace/assets?projectId=${project.id}&q=${encodeURIComponent(query)}&kind=${kind}&offset=${page.nextOffset}`,
        { signal: AbortSignal.timeout(10000) },
      );
      const result = (await response.json()) as LibraryPage & {
        error?: string;
      };
      if (!response.ok)
        throw new Error(result.error || "More media could not be loaded.");
      if (alive.current && version === generation.current)
        setPage((current) =>
          current
            ? {
                ...result,
                items: [
                  ...new Map(
                    [...current.items, ...result.items].map((item) => [
                      item.asset.id,
                      item,
                    ]),
                  ).values(),
                ],
              }
            : current,
        );
    } catch (error) {
      if (alive.current && version === generation.current)
        setError(
          error instanceof Error
            ? error.message
            : "More media could not be loaded.",
        );
    } finally {
      if (alive.current) setLoadingMore(false);
    }
  }
  async function reuse(item: LibraryItem) {
    setPending(item.asset.id);
    setError("");
    setNotice("");
    try {
      const response = await request(
        `/api/projects/${project.id}/assets/link`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sourceProjectId: item.sourceProject.id,
            assetId: item.asset.id,
          }),
          signal: AbortSignal.timeout(15000),
        },
      );
      const result = await response.json();
      if (!response.ok)
        throw new Error(
          result.error ||
            "Media could not be reused. Refresh the library and try again.",
        );
      if (alive.current) {
        onProject(result);
        setNotice(
          `Added ${item.asset.name} to this project's assets. Use it in a scene or audio track.`,
        );
      }
    } catch (error) {
      if (alive.current)
        setError(
          error instanceof Error
            ? error.message
            : "Media could not be reused. Refresh the library and try again.",
        );
    } finally {
      if (alive.current) setPending(null);
    }
  }
  return (
    <details
      className="studio-media-library"
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>Reuse media from your studio</summary>
      {open && (
        <section aria-label="Studio media library">
          <p>
            Choose an upload from another active project. Usage rights stay
            attached, and shared files count once toward your studio’s storage.
          </p>
          <div className="layer-fields">
            <label>
              Find an upload
              <input
                aria-label="Search studio media"
                type="search"
                maxLength={100}
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setPage(null);
                  setError("");
                }}
              />
            </label>
            <label>
              Media type
              <select
                aria-label="Studio media type"
                value={kind}
                onChange={(event) => {
                  setKind(event.target.value as LibraryQuery["kind"]);
                  setPage(null);
                  setError("");
                }}
              >
                <option value="all">All uploads</option>
                <option value="image">Images</option>
                <option value="video">Video</option>
                <option value="audio">Audio</option>
              </select>
            </label>
            <button
              type="button"
              className="subtle"
              aria-label="Refresh studio media"
              onClick={refresh}
            >
              Refresh library
            </button>
          </div>
          {notice && <p role="status">{notice}</p>}
          {error && (
            <p role="alert" aria-label="Studio media error">
              {error}
            </p>
          )}
          {!page ? (
            <p role="status">
              {error
                ? "Media library unavailable. Use Refresh library to try again."
                : "Loading your studio media…"}
            </p>
          ) : (
            <>
              <p>
                {page.total} matching {page.total === 1 ? "upload" : "uploads"}
              </p>
              {page.items.length ? (
                <ul className="studio-media-items">
                  {page.items.map((item) => {
                    const asset = item.asset;
                    const src = `/api/projects/${encodeURIComponent(item.sourceProject.id)}/assets/${asset.id}`;
                    const added = project.assets?.some(
                      (current) => current.id === asset.id,
                    );
                    return (
                      <li key={asset.id}>
                        {asset.mime === "image/png" ? (
                          <img
                            src={src}
                            alt={asset.name}
                            width={160}
                            height={90}
                            loading="lazy"
                          />
                        ) : asset.mime === "video/mp4" ? (
                          <video
                            src={src}
                            controls
                            preload="none"
                            muted
                            aria-label={`${asset.name} preview`}
                          />
                        ) : (
                          <audio
                            src={src}
                            controls
                            preload="none"
                            aria-label={`${asset.name} preview`}
                          />
                        )}
                        <h3>{asset.name || "Untitled upload"}</h3>
                        <small>From {item.sourceProject.name}</small>
                        <p>{asset.license}</p>
                        <button
                          type="button"
                          className="subtle"
                          aria-label={
                            added
                              ? `${asset.name} is already in this project`
                              : `Reuse ${asset.name}`
                          }
                          disabled={
                            !!pending ||
                            added ||
                            (project.assets?.length || 0) >= 30
                          }
                          onClick={() => void reuse(item)}
                        >
                          {pending === asset.id
                            ? "Adding…"
                            : added
                              ? "Added to project"
                              : "Reuse in this project"}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p>
                  {query || kind !== "all"
                    ? "No uploads match this search."
                    : "Uploads from your other active projects will appear here."}
                </p>
              )}
              {page.nextOffset !== null && (
                <button
                  type="button"
                  className="subtle"
                  disabled={loadingMore}
                  onClick={() => void loadMore()}
                >
                  {loadingMore ? "Loading media…" : "Load more studio media"}
                </button>
              )}
            </>
          )}
          {(project.assets?.length || 0) >= 30 && (
            <p>This project has reached its 30-upload limit.</p>
          )}
        </section>
      )}
    </details>
  );
}
