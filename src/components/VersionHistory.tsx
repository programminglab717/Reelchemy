"use client";
import type { EditorProject as Project } from "@/lib/project-view";
import { useEffect, useRef, useState } from "react";
import { Player } from "@remotion/player";
import { Film } from "@/video/Composition";
import { videoDimensions, totalFrames, timelineSchema } from "@/lib/schema";
import type {
  SavedVersion,
  SavedVersionPage,
  SavedVersionSnapshot,
} from "@/lib/project-history";
import { useAccountFetch } from "./AccountBoundary";
import { previewMotionBaseUrl } from "@/motion/preview";
function validVersion(value: unknown): value is SavedVersion {
  if (!value || typeof value !== "object") return false;
  const version = value as SavedVersion;
  return (
    typeof version.id === "string" &&
    version.id.length > 0 &&
    version.id.length <= 80 &&
    typeof version.source === "string" &&
    version.source.length <= 500 &&
    Number.isSafeInteger(version.number) &&
    version.number > 0 &&
    (version.createdAt === null ||
      (typeof version.createdAt === "string" &&
        version.createdAt.length <= 40 &&
        Number.isFinite(Date.parse(version.createdAt))))
  );
}

export function VersionHistory({
  projectId,
  latestRevisionId,
  count,
  disabled,
  canRestore,
  onOpen,
  onRestored,
}: {
  projectId: string;
  latestRevisionId: string | null;
  count: number;
  disabled: boolean;
  canRestore: boolean;
  onOpen: () => void;
  onRestored: (project: Project) => void;
}) {
  const request = useAccountFetch(),
    dialog = useRef<HTMLDialogElement>(null),
    opener = useRef<HTMLButtonElement>(null);
  const activeRestores = useRef(new Set<AbortController>());
  const [open, setOpen] = useState(false),
    [offset, setOffset] = useState(0),
    [page, setPage] = useState<SavedVersionPage | null>(null);
  const [selected, setSelected] = useState<SavedVersion | null>(null),
    [snapshot, setSnapshot] = useState<SavedVersionSnapshot | null>(null);
  const [pageError, setPageError] = useState(""),
    [previewError, setPreviewError] = useState(""),
    [loading, setLoading] = useState(false),
    [restoring, setRestoring] = useState(false),
    [retry, setRetry] = useState(0);
  const [restoreProblem, setRestoreProblem] = useState(false);
  const endpoint = `/api/projects/${encodeURIComponent(projectId)}/history`;
  useEffect(() => {
    if (!open) return;
    const element = dialog.current;
    const originalButton = opener.current;
    element?.showModal();
    return () => {
      element?.close();
      if (originalButton?.isConnected) originalButton.focus();
    };
  }, [open]);
  useEffect(() => {
    const controllers = activeRestores.current;
    return () => {
      for (const controller of controllers) controller.abort();
    };
  }, []);
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await request(`${endpoint}?offset=${offset}`, {
          signal: AbortSignal.any([
            controller.signal,
            AbortSignal.timeout(15000),
          ]),
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok)
          throw new Error(
            result.error || "Saved versions could not be loaded.",
          );
        if (controller.signal.aborted) return;
        if (
          !Array.isArray(result.items) ||
          result.items.length > 20 ||
          !result.items.every(validVersion) ||
          !Number.isSafeInteger(result.total) ||
          result.total < 0 ||
          !Number.isSafeInteger(result.unavailable) ||
          result.unavailable < 0 ||
          result.unavailable > 20 ||
          (result.nextOffset !== null &&
            (!Number.isSafeInteger(result.nextOffset) ||
              result.nextOffset <= offset ||
              result.nextOffset >= result.total))
        )
          throw new Error(
            "The saved history response was incomplete. Try again.",
          );
        setPage(result);
        setSelected((current) => current || result.items[0] || null);
        setPageError("");
      } catch (error) {
        if (!controller.signal.aborted)
          setPageError(
            error instanceof Error
              ? error.message
              : "Saved versions could not be loaded.",
          );
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [open, offset, latestRevisionId, endpoint, request, retry]);
  useEffect(() => {
    if (!open || !selected) return;
    const controller = new AbortController();
    void (async () => {
      try {
        const query = new URLSearchParams({ revisionId: selected.id });
        const response = await request(`${endpoint}?${query}`, {
          signal: AbortSignal.any([
            controller.signal,
            AbortSignal.timeout(15000),
          ]),
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok)
          throw new Error(
            result.error || "This saved version could not be previewed.",
          );
        const timeline = timelineSchema.safeParse(result.timeline);
        if (
          result.projectId !== projectId ||
          !validVersion(result.version) ||
          !timeline.success ||
          !Array.isArray(result.assets) ||
          result.assets.length > 30 ||
          !result.assets.every(
            (asset: { id?: unknown }) => typeof asset?.id === "string",
          ) ||
          typeof result.mediaAvailable !== "boolean" ||
          result.version?.id !== selected.id ||
          result.version?.number !== selected.number
        )
          throw new Error(
            "The saved version changed. Close this preview and browse again.",
          );
        if (!controller.signal.aborted) {
          setSnapshot({ ...result, timeline: timeline.data });
          setPreviewError("");
        }
      } catch (error) {
        if (!controller.signal.aborted)
          setPreviewError(
            error instanceof Error
              ? error.message
              : "This saved version could not be previewed.",
          );
      }
    })();
    return () => controller.abort();
  }, [open, selected, projectId, endpoint, request, retry]);
  function browse() {
    onOpen();
    setOffset(0);
    setPage(null);
    setSelected(null);
    setSnapshot(null);
    setPageError("");
    setPreviewError("");
    setRestoreProblem(false);
    setLoading(true);
    setOpen(true);
  }
  async function restore() {
    if (
      !snapshot ||
      !canRestore ||
      restoring ||
      !snapshot.mediaAvailable ||
      snapshot.version.id === latestRevisionId
    )
      return;
    const controller = new AbortController();
    activeRestores.current.add(controller);
    setRestoring(true);
    setPreviewError("");
    try {
      const response = await request(
        `/api/projects/${encodeURIComponent(projectId)}/restore`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            revisionId: snapshot.version.id,
            baseRevisionId: latestRevisionId,
          }),
          signal: AbortSignal.any([
            controller.signal,
            AbortSignal.timeout(15000),
          ]),
        },
      );
      const result = await response.json().catch(() => ({}));
      if (!response.ok)
        throw new Error(
          result.error ||
            "The restore could not be confirmed. Your current editing copy is still here.",
        );
      if (
        result.id !== projectId ||
        !result.timeline ||
        !Array.isArray(result.revisions) ||
        !result.revisions.length ||
        !Array.isArray(result.messages) ||
        !result.brief ||
        typeof result.name !== "string"
      )
        throw new Error(
          "The restore result could not be confirmed. Close this preview and reopen the project.",
        );
      controller.signal.throwIfAborted();
      onRestored(result);
      setOpen(false);
    } catch (error) {
      if (!controller.signal.aborted) {
        setRestoreProblem(true);
        setPreviewError(
          error instanceof Error
            ? error.message
            : "The restore could not be confirmed. Your current editing copy is still here.",
        );
      }
    } finally {
      activeRestores.current.delete(controller);
      if (!controller.signal.aborted) setRestoring(false);
    }
  }
  async function reloadCurrent() {
    if (restoring || !canRestore) return;
    const controller = new AbortController();
    activeRestores.current.add(controller);
    setRestoring(true);
    try {
      const response = await request(
        `/api/projects/${encodeURIComponent(projectId)}`,
        {
          signal: AbortSignal.any([
            controller.signal,
            AbortSignal.timeout(15000),
          ]),
        },
      );
      const result = await response.json().catch(() => ({}));
      if (!response.ok)
        throw new Error(
          result.error || "The current saved film could not be loaded.",
        );
      if (
        result.id !== projectId ||
        !result.timeline ||
        !Array.isArray(result.revisions) ||
        !Array.isArray(result.messages) ||
        !result.brief ||
        typeof result.name !== "string"
      )
        throw new Error(
          "The current saved film response was incomplete. Your editing copy is still here.",
        );
      controller.signal.throwIfAborted();
      onRestored(result);
      setOpen(false);
    } catch (error) {
      if (!controller.signal.aborted)
        setPreviewError(
          error instanceof Error
            ? error.message
            : "The current saved film could not be loaded.",
        );
    } finally {
      activeRestores.current.delete(controller);
      if (!controller.signal.aborted) setRestoring(false);
    }
  }
  return (
    <>
      <button
        ref={opener}
        type="button"
        className="subtle"
        disabled={disabled || count === 0}
        onClick={browse}
      >
        Browse saved versions
      </button>
      {open && (
        <dialog
          ref={dialog}
          className="version-history-dialog"
          aria-labelledby="version-history-title"
          onKeyDown={(event) => event.stopPropagation()}
          onCancel={(event) => {
            event.preventDefault();
            if (!restoring) setOpen(false);
          }}
        >
          <header className="version-history-header">
            <div>
              <h2 id="version-history-title">Saved versions</h2>
              <p>Preview a saved film before restoring it.</p>
            </div>
            <button
              type="button"
              className="subtle"
              disabled={restoring}
              onClick={() => setOpen(false)}
            >
              Close preview
            </button>
          </header>
          <div className="version-history-body">
            <section
              aria-label="Saved version list"
              className="version-history-list"
            >
              {loading && <p role="status">Loading saved versions…</p>}
              {pageError && <p role="alert">{pageError}</p>}
              {page && !loading && (
                <p className="version-history-range">
                  {page.total
                    ? `Versions ${Math.min(offset + 1, page.total)}–${Math.min(offset + 20, page.total)} of ${page.total}`
                    : "No saved versions yet."}
                </p>
              )}
              {!!page?.unavailable && (
                <p>Some older entries on this page could not be read.</p>
              )}
              <div className="version-history-entries">
                {page?.items.map((version) => (
                  <button
                    key={version.number}
                    type="button"
                    aria-label={`Preview saved version ${version.number}`}
                    aria-pressed={selected?.number === version.number}
                    disabled={restoring || loading}
                    onClick={() => {
                      setSelected(version);
                      setSnapshot(null);
                      setPreviewError("");
                      setRestoreProblem(false);
                    }}
                  >
                    <strong>
                      Version {version.number}
                      {version.id === latestRevisionId ? " · Current" : ""}
                    </strong>
                    <span>{version.source}</span>
                    <small>
                      {version.createdAt
                        ? new Date(version.createdAt).toLocaleString()
                        : "Date unavailable"}
                    </small>
                  </button>
                ))}
              </div>
              <div className="version-history-pagination">
                <button
                  type="button"
                  className="subtle"
                  disabled={restoring || loading || offset === 0}
                  onClick={() => {
                    setOffset(Math.max(0, offset - 20));
                    setLoading(true);
                    setPageError("");
                  }}
                >
                  Newer versions
                </button>
                <button
                  type="button"
                  className="subtle"
                  disabled={restoring || loading || page?.nextOffset == null}
                  onClick={() => {
                    if (page?.nextOffset != null) {
                      setOffset(page.nextOffset);
                      setLoading(true);
                      setPageError("");
                    }
                  }}
                >
                  Older versions
                </button>
              </div>
              {pageError && (
                <button
                  type="button"
                  className="subtle"
                  onClick={() => {
                    setLoading(true);
                    setRetry((value) => value + 1);
                  }}
                >
                  Retry history
                </button>
              )}
            </section>
            <section
              className="version-history-preview"
              aria-label="Saved version preview"
            >
              {previewError ? (
                <>
                  <p role="alert">{previewError}</p>
                  {restoreProblem ? (
                    <div className="version-history-pagination">
                      <button
                        type="button"
                        className="subtle"
                        disabled={restoring || !canRestore}
                        onClick={() => void restore()}
                      >
                        Retry restore
                      </button>
                      <button
                        type="button"
                        className="subtle"
                        disabled={restoring || !canRestore}
                        onClick={() => void reloadCurrent()}
                      >
                        Reload current saved film
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      className="subtle"
                      disabled={restoring}
                      onClick={() => {
                        setPreviewError("");
                        setSnapshot(null);
                        setRetry((value) => value + 1);
                      }}
                    >
                      Retry preview
                    </button>
                  )}
                </>
              ) : selected && !snapshot ? (
                <p role="status">Loading version {selected.number}…</p>
              ) : !selected ? (
                <p>Choose a saved version to preview.</p>
              ) : null}
              {snapshot && (
                <>
                  <h3>Version {snapshot.version.number}</h3>
                  <p className="version-history-source">
                    {snapshot.version.source}
                  </p>
                  {snapshot.mediaAvailable ? (
                    <div className="player-wrap">
                      <Player
                        key={snapshot.version.id}
                        component={Film}
                        inputProps={{
                          timeline: snapshot.timeline,
                          motionBaseUrl: previewMotionBaseUrl(),
                          assetSources: Object.fromEntries(
                            snapshot.assets.map((asset) => [
                              asset.id,
                              `/api/projects/${encodeURIComponent(projectId)}/assets/${asset.id}`,
                            ]),
                          ),
                        }}
                        durationInFrames={totalFrames(snapshot.timeline)}
                        fps={30}
                        compositionWidth={
                          videoDimensions(snapshot.timeline).width
                        }
                        compositionHeight={
                          videoDimensions(snapshot.timeline).height
                        }
                        initialFrame={Math.min(
                          15,
                          totalFrames(snapshot.timeline) - 1,
                        )}
                        controls
                        errorFallback={() => (
                          <p role="alert">
                            This saved version could not be played. Its retained
                            media may be unavailable. Your current edit is still
                            here.
                          </p>
                        )}
                        style={{
                          width: "100%",
                          maxWidth:
                            (420 * videoDimensions(snapshot.timeline).width) /
                            videoDimensions(snapshot.timeline).height,
                          aspectRatio: `${videoDimensions(snapshot.timeline).width}/${videoDimensions(snapshot.timeline).height}`,
                        }}
                      />
                    </div>
                  ) : (
                    <p role="status">
                      Some media used by this version is unavailable. Keep
                      editing your current film or use a project archive for
                      recovery.
                    </p>
                  )}
                  <p>
                    {snapshot.timeline.scenes.length} scenes ·{" "}
                    {totalFrames(snapshot.timeline) / 30}s ·{" "}
                    {snapshot.timeline.format}
                  </p>
                </>
              )}
            </section>
          </div>
          <footer className="version-history-footer">
            <p>
              {!canRestore
                ? "Finish saving your current edits before restoring."
                : snapshot?.version.id === latestRevisionId
                  ? "This is the current saved version."
                  : "Restoring creates a new saved version. Earlier versions stay available."}
            </p>
            <button
              type="button"
              className="primary"
              disabled={
                restoring ||
                !canRestore ||
                !snapshot?.mediaAvailable ||
                !!previewError ||
                !!pageError ||
                snapshot.version.id === latestRevisionId
              }
              onClick={() => void restore()}
            >
              {restoring ? "Working…" : "Restore this version"}
            </button>
          </footer>
        </dialog>
      )}
    </>
  );
}
