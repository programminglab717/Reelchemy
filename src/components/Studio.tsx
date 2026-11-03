"use client";
import type { EditorProject as Project } from "@/lib/project-view";
import { clipAudioTracks } from "@/lib/clip-audio";
import { CanvasEditor } from "./CanvasEditor";
import { TimelineEditor } from "./TimelineEditor";
import { useProjectEditor } from "./useProjectEditor";
import {
  BrowserDraftRecovery,
  downloadDraft,
  confirmDraftRecovery,
} from "./BrowserDraftRecovery";
import {
  createBrowserDraft,
  parseDownloadedDraft,
  MAX_DOWNLOADED_DRAFT_BYTES,
} from "@/lib/browser-drafts";
import { revisionId, RevisionConflict } from "@/lib/editor";
import { AssetPanel } from "./AssetPanel";
import { ProjectName } from "./ProjectName";
import { LayerEditor } from "./LayerEditor";
import { WorkspaceExports } from "./WorkspaceExports";
import { ExportFiles } from "./ExportFiles";
import { ExportHistory, QualityEvidence } from "./ExportHistory";
import { MediaEditor } from "./MediaEditor";
import { ImportProject, DownloadProject } from "./ProjectPortability";
import { MediaProcessing } from "./MediaProcessing";
import { VersionHistory } from "./VersionHistory";
import { ProjectHistoryStorage } from "./ProjectHistoryStorage";
import { CreativeConversation } from "./CreativeConversation";
import { savedVersionCount } from "@/lib/project-view";
import { useAccountFetch } from "./AccountBoundary";
import { Icon, type IconName } from "./Icon";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Player, type PlayerRef } from "@remotion/player";
import { Film } from "@/video/Composition";
import {
  formats,
  totalFrames,
  type ProjectSummary,
  type RenderJob,
  type Timeline,
  type Layer,
} from "@/lib/schema";
const ideas: { icon: IconName; tag: string; title: string; prompt: string }[] =
  [
    {
      icon: "arrow-up-right",
      tag: "EXPLAINER",
      title: "Make the complex, clear.",
      prompt: "Explain how a small idea grows into something extraordinary.",
    },
    {
      icon: "sun",
      tag: "STORY",
      title: "Build a world worth watching.",
      prompt:
        "A quiet journey through an imaginary mountain landscape at sunrise.",
    },
    {
      icon: "sparkle",
      tag: "PROMO",
      title: "Give your next launch a little magic.",
      prompt: "A bold, minimal launch film for a new creative notebook.",
    },
  ];
export function Studio({
  userId,
  userName,
}: {
  userId: string;
  userName: string;
}) {
  const displayName = userName.trim() || "Creator";
  const router = useRouter();
  const accountFetch = useAccountFetch();
  const api = useCallback(
    async <T,>(
      url: string,
      method = "GET",
      data?: unknown,
      headers?: Record<string, string>,
    ): Promise<T> => {
      const r = await accountFetch(url, {
        method,
        headers: {
          ...(data ? { "Content-Type": "application/json" } : {}),
          ...headers,
        },
        body: data ? JSON.stringify(data) : undefined,
      });
      const result = await r.json();
      if (!r.ok) {
        if (result.code === "REVISION_CONFLICT") throw new RevisionConflict();
        throw new Error(result.error || "Request failed");
      }
      return result;
    },
    [accountFetch],
  );

  const editor = useProjectEditor(userId);
  const { project, dirty, save, change: editorChange } = editor;
  const [projects, setProjects] = useState<ProjectSummary[]>([]),
    [prompt, setPrompt] = useState(""),
    [duration, setDuration] = useState(15),
    [format, setFormat] = useState<Timeline["format"]>("landscape");
  const [ready, setReady] = useState(false);
  const [projectQuery, setProjectQuery] = useState("");
  const [listedQuery, setListedQuery] = useState<string | null>(null);
  const [projectCount, setProjectCount] = useState(0);
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [listRefresh, setListRefresh] = useState(0);
  const [historyCleanup, setHistoryCleanup] = useState(0);
  const listVersion = useRef(0);
  const pendingExport = useRef<{
    projectId: string;
    revisionId: string | null;
    key: string;
  } | null>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [job, setJob] = useState<RenderJob | null>(null),
    [selection, setSelected] = useState(0),
    [revision, setRevision] = useState(""),
    [revisionScope, setRevisionScope] = useState("scene");
  const selected = Math.min(
    selection,
    Math.max(0, (project?.timeline?.scenes.length || 1) - 1),
  );
  const [scenePreview, setScenePreview] = useState(false);
  const [recordingPending, setRecordingPending] = useState(false);
  const [recordingActive, setRecordingActive] = useState(false);
  const player = useRef<PlayerRef>(null);
  useEffect(() => {
    const version = ++listVersion.current;
    const controller = new AbortController();
    const timer = setTimeout(
      () => {
        void accountFetch(
          `/api/projects?limit=20&q=${encodeURIComponent(projectQuery)}&view=summary`,
          { signal: controller.signal },
        )
          .then(async (response) => {
            const result = await response.json();
            if (!response.ok)
              throw new Error(result.error || "Could not load projects.");
            if (controller.signal.aborted || version !== listVersion.current)
              return;
            setProjects(result);
            setListedQuery(projectQuery);
            setProjectCount(Number(response.headers.get("X-Total-Count") || 0));
            setNextOffset(
              response.headers.has("X-Next-Offset")
                ? Number(response.headers.get("X-Next-Offset"))
                : null,
            );
          })
          .catch((e) => {
            if (!controller.signal.aborted) setError(e.message);
          })
          .finally(() => {
            if (!controller.signal.aborted) setReady(true);
          });
      },
      projectQuery ? 250 : 0,
    );
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [projectQuery, listRefresh, accountFetch]);
  async function loadMoreProjects() {
    if (nextOffset === null || loadingMore) return;
    const version = listVersion.current;
    setLoadingMore(true);
    try {
      const response = await accountFetch(
        `/api/projects?limit=20&offset=${nextOffset}&q=${encodeURIComponent(projectQuery)}&view=summary`,
      );
      const result = await response.json();
      if (!response.ok)
        throw new Error(result.error || "Could not load projects.");
      if (version !== listVersion.current) return;
      setProjects((old) => [
        ...new Map([...old, ...result].map((p) => [p.id, p])).values(),
      ]);
      setProjectCount(Number(response.headers.get("X-Total-Count") || 0));
      setNextOffset(
        response.headers.has("X-Next-Offset")
          ? Number(response.headers.get("X-Next-Offset"))
          : null,
      );
    } catch (e) {
      if (version === listVersion.current) setError((e as Error).message);
    } finally {
      setLoadingMore(false);
    }
  }
  useEffect(() => {
    if (!job || !["queued", "rendering"].includes(job.status)) return;
    const timer = setInterval(
      () =>
        api<RenderJob>(`/api/jobs/${job.id}`)
          .then(setJob)
          .catch((e) => setError(e.message)),
      1000,
    );
    return () => clearInterval(timer);
  }, [job, api]);
  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      if (e instanceof RevisionConflict) editor.markConflict(e.message);
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }
  function remember(p: Project | null) {
    editor.open(p);
    if (p) setListRefresh((n) => n + 1);
  }
  async function create(blank = false) {
    await run(async () => {
      let p = await api<Project>("/api/projects", "POST", {
        prompt: blank ? "Untitled creation" : prompt,
        blank,
        duration,
        format,
      });
      remember(p);
      if (!blank)
        p = await api<Project>(`/api/projects/${p.id}/plan`, "POST", {});
      remember(p);
      setSelected(0);
      setJob(null);
    });
  }
  async function navigate(p: Pick<Project, "id"> | null) {
    await run(async () => {
      if (recordingPending)
        throw new Error(
          "Save or discard your narration take before leaving this project.",
        );
      await save();
      remember(p ? await api<Project>(`/api/projects/${p.id}`) : null);
      setSelected(0);
      setJob(null);
    });
  }
  function changeTimeline(t: Timeline) {
    editor.change(t);
    setSelected(Math.min(selected, t.scenes.length - 1));
    setJob(null);
  }
  async function signOut() {
    await run(async () => {
      if (recordingPending)
        throw new Error(
          "Save or discard your narration take before signing out.",
        );
      await save();
      const copies = editor.browserDraftCount();
      if (
        copies !== 0 &&
        !window.confirm(
          `${copies === null ? "This browser could not check its recovery copies." : `There ${copies === 1 ? "is 1 recovery copy" : `are ${copies} recovery copies`} for this account in this browser.`} Signing out clears these copies, including copies from other tabs. Recover or download them first if you want to keep them. Sign out and discard the copies?`,
        )
      )
        return;
      const result = await accountFetch("/api/auth/sign-out", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      if (!result.ok) throw new Error("Could not sign out. Try again.");
      editor.clearBrowserDrafts();
      router.replace("/sign-in");
      router.refresh();
    });
  }
  async function openTrash() {
    await run(async () => {
      if (recordingPending)
        throw new Error(
          "Save or discard your narration take before opening Trash.",
        );
      await save();
      router.push("/trash");
    });
  }
  async function trashCurrentProject() {
    if (!project) return;
    await run(async () => {
      if (recordingPending)
        throw new Error(
          "Save or discard your narration take before moving this project to Trash.",
        );
      if (
        !window.confirm(
          `Move “${project.name}” to Trash? Its media and saved versions will be kept. Active exports will be cancelled. You can restore it from Trash.`,
        )
      )
        return;
      await save();
      await api(`/api/projects/${project.id}/trash`, "DELETE");
      remember(null);
      setJob(null);
      setSelected(0);
      setListRefresh((n) => n + 1);
    });
  }
  function changeScene(update: Partial<Timeline["scenes"][number]>) {
    if (!project?.timeline) return;
    changeTimeline({
      ...project.timeline,
      scenes: project.timeline.scenes.map((s, i) =>
        i === selected ? { ...s, ...update } : s,
      ),
    });
  }
  const timeline = project?.timeline,
    scene = timeline?.scenes[Math.min(selected, timeline.scenes.length - 1)];
  const previewStart =
    timeline && scenePreview
      ? timeline.scenes
          .slice(0, selected)
          .reduce((n, s) => n + s.durationFrames, 0)
      : 0;
  const previewEnd = timeline
    ? (scenePreview
        ? previewStart + (scene?.durationFrames || 30)
        : totalFrames(timeline)) - 1
    : 29;
  const active = job && ["queued", "rendering"].includes(job.status);
  useEffect(() => {
    const keyboard = (e: KeyboardEvent) => {
      if (busy || !project?.timeline || !(e.ctrlKey || e.metaKey)) return;
      const target = e.target as HTMLElement;
      if (target.closest("input,textarea,select,[contenteditable=true]"))
        return;
      if (e.key.toLowerCase() === "z") {
        e.preventDefault();
        editorChange(e.shiftKey ? "redo" : "undo");
        setJob(null);
      }
      if (e.key.toLowerCase() === "s") {
        e.preventDefault();
        void save().catch(() => {});
      }
    };
    window.addEventListener("keydown", keyboard);
    return () => window.removeEventListener("keydown", keyboard);
  }, [busy, project, editorChange, save]);

  return (
    <div className="shell">
      <aside className="sidebar">
        <Link
          className="wordmark"
          href="/"
          aria-label="Reelchemy home"
          onClick={(e) => {
            e.preventDefault();
            if (!busy) void navigate(null);
          }}
        >
          <span className="brand-icon">
            r
            <span>
              <Icon name="sparkle" size={14} />
            </span>
          </span>
          reelchemy<span className="beta">BETA</span>
        </Link>
        <button
          className="new-project"
          aria-label="New creation"
          onClick={() => void navigate(null)}
          disabled={busy || editor.saving}
        >
          <Icon name="plus" /> <span>New creation</span>
          <kbd aria-hidden="true">
            <Icon name="return-key" size={14} />
          </kbd>
        </button>
        <div className="nav-label">YOUR WORKSPACE</div>
        <button
          className={`nav-item ${!project ? "current" : ""}`}
          aria-label="Studio"
          onClick={() => void navigate(null)}
          disabled={busy || editor.saving}
        >
          <Icon name="grid" /> <span>Studio</span>
          <span className="count">{projectCount}</span>
        </button>
        <div className="recent-label">RECENT PROJECTS</div>
        <button
          className="nav-item"
          aria-label="Trash"
          title="Trash"
          disabled={busy || editor.saving}
          onClick={() => void openTrash()}
        >
          <Icon name="trash" /> <span>Trash</span>
        </button>
        <label className="project-search">
          Find a project
          <input
            aria-label="Search projects"
            value={projectQuery}
            maxLength={100}
            placeholder="Search by name…"
            onChange={(e) => setProjectQuery(e.target.value)}
          />
        </label>
        <div className="project-list">
          {listedQuery !== projectQuery ? (
            <p role="status">Searching projects…</p>
          ) : projects.length ? (
            projects.map((p) => (
              <button
                key={p.id}
                className={`project-item ${project?.id === p.id ? "chosen" : ""}`}
                onClick={() => void navigate(p)}
                disabled={busy || editor.saving}
              >
                <Icon name="document" size={14} />
                <span>{p.name}</span>
              </button>
            ))
          ) : (
            <p className="empty-recent">
              {projectQuery
                ? "No projects match this name."
                : "Your next great idea starts here."}
            </p>
          )}
          {listedQuery === projectQuery && nextOffset !== null && (
            <button
              className="subtle"
              disabled={loadingMore}
              onClick={() => void loadMoreProjects()}
            >
              {loadingMore ? "Loading projects…" : "Load more projects"}
            </button>
          )}
        </div>
        <div className="sidebar-bottom">
          <div className="mode-dot" />
          Your creative workspace<p>Private projects & exports</p>
          <button
            className="subtle"
            disabled={busy || editor.saving}
            onClick={() => void signOut()}
          >
            Sign out
          </button>
          <div className="profile" role="group" aria-label="Signed-in account">
            <span className="avatar" aria-hidden="true">
              {(Array.from(displayName)[0] || "C").toUpperCase()}
            </span>
            <div>
              <span className="profile-name" title={displayName}>
                {displayName}
              </span>
              <small>Personal studio</small>
            </div>
          </div>
        </div>
      </aside>
      <main>
        <header className="topbar">
          <button
            className="subtle mobile-sign-out"
            disabled={busy || editor.saving}
            onClick={() => void signOut()}
          >
            Sign out
          </button>
          <div>
            Workspace <span>/</span>{" "}
            <strong>{project ? "Project studio" : "Studio"}</strong>
          </div>
          <span className="private">
            <Icon name="lock" size={14} /> Private workspace
          </span>
        </header>
        <div
          className="mobile-account-identity"
          role="group"
          aria-label="Signed-in account"
        >
          <Icon name="lock" size={13} /> Studio for{" "}
          <strong title={displayName}>{displayName}</strong>
        </div>
        <WorkspaceExports
          refreshKey={job ? `${job.id}:${job.status}` : ""}
          disabled={busy || editor.saving}
          onOpen={(id) => navigate({ id })}
          onJob={(updated) => {
            if (job?.id === updated.id) setJob(updated);
          }}
        />
        <MediaProcessing
          onOpen={(id) => navigate({ id })}
          disabled={busy || editor.saving}
        />
        {!project ? (
          <div className="home">
            <div className="intro-label">
              <span /> A LITTLE IMAGINATION. ENDLESS POSSIBILITIES.
            </div>
            <h1>
              Big ideas.
              <br />
              <span>Beautifully in motion.</span>
            </h1>
            <p className="intro">
              From a spark of an idea to a story worth sharing.
              <br />
              Tell your creative director what you have in mind.
            </p>
            <form
              className="prompt-card"
              onSubmit={(e) => {
                e.preventDefault();
                void create();
              }}
            >
              <div className="composer-label">
                <Icon name="sparkle" size={24} /> What are we creating today?
              </div>
              <textarea
                aria-label="Video idea"
                disabled={!ready || busy}
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="A dreamy journey through the mountains. A product people can't ignore. An idea that finally clicks…"
                maxLength={1200}
                required
                minLength={3}
              />
              <div className="composer-footer">
                <div className="options">
                  <label>
                    <Icon name="frame" size={14} />
                    <select
                      aria-label="Aspect ratio"
                      value={format}
                      onChange={(e) =>
                        setFormat(e.target.value as typeof format)
                      }
                    >
                      <option value="landscape">16:9 Landscape</option>
                      <option value="portrait">9:16 Portrait</option>
                      <option value="square">1:1 Square</option>
                    </select>
                  </label>
                  <label>
                    <Icon name="clock" size={14} />
                    <select
                      aria-label="Duration"
                      value={duration}
                      onChange={(e) => setDuration(Number(e.target.value))}
                    >
                      {[5, 15, 30, 60].map((d) => (
                        <option key={d} value={d}>
                          {d} seconds
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <button
                  className="primary"
                  disabled={busy || prompt.trim().length < 3}
                >
                  {busy ? "Planning…" : "Create storyboard"}{" "}
                  <Icon name="arrow-up-right" />
                </button>
              </div>
            </form>
            <button
              className="subtle blank-start"
              disabled={!ready || busy}
              onClick={() => void create(true)}
            >
              Start from a blank canvas
            </button>
            <div className="composer-note">
              <Icon name="sparkle" size={12} /> Demo director · Procedural
              animation · You approve before export
            </div>
            <div className="section-heading">
              <h2>A starting point for your imagination</h2>
              <span>YOUR IDEA, YOUR DIRECTION</span>
            </div>
            <div className="idea-grid">
              {ideas.map((idea, i) => (
                <button
                  key={idea.tag}
                  className={`idea-card idea-${i}`}
                  onClick={() => setPrompt(idea.prompt)}
                >
                  <div className="idea-art">
                    <div className="art-ring ring-a" />
                    <div className="art-ring ring-b" />
                    <span>
                      <Icon
                        name={idea.icon}
                        size={i === 1 ? 36 : i === 2 ? 84 : 62}
                      />
                    </span>
                    {i === 1 && <div className="hills" />}
                  </div>
                  <div className="idea-content">
                    <small>{idea.tag}</small>
                    <h3>{idea.title}</h3>
                    <span className="idea-arrow">
                      <Icon name="arrow-up-right" size={16} />
                    </span>
                  </div>
                </button>
              ))}
            </div>
            <ImportProject
              onImport={(p) => {
                remember(p);
                setSelected(0);
                setJob(null);
              }}
            />
            <section
              className="mobile-project-library"
              aria-label="Your projects"
            >
              <h2>Your projects</h2>
              <Link href="/trash" className="subtle">
                Open Trash
              </Link>
              <label>
                Find a project
                <input
                  aria-label="Search projects"
                  value={projectQuery}
                  maxLength={100}
                  placeholder="Search by name…"
                  onChange={(e) => setProjectQuery(e.target.value)}
                />
              </label>
              {listedQuery !== projectQuery ? (
                <p role="status">Searching projects…</p>
              ) : projects.length ? (
                <ul>
                  {projects.map((p) => (
                    <li key={p.id}>
                      <button
                        className="subtle"
                        onClick={() => void navigate(p)}
                        disabled={busy || editor.saving}
                      >
                        {p.name}
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p>
                  {projectQuery
                    ? "No projects match this name."
                    : "Your saved projects will appear here."}
                </p>
              )}
              {listedQuery === projectQuery && nextOffset !== null && (
                <button
                  className="subtle"
                  disabled={loadingMore}
                  onClick={() => void loadMoreProjects()}
                >
                  {loadingMore ? "Loading projects…" : "Load more projects"}
                </button>
              )}
            </section>
            <p className="home-foot">
              No templates to fit into. Just room to create.
            </p>
          </div>
        ) : (
          <div className="project-workspace">
            <div className="project-heading">
              <div>
                <span className="eyebrow">CREATION WORKSPACE</span>
                <h1>{project.name}</h1>
                <ProjectName
                  key={project.id}
                  name={project.name}
                  onRename={async (name) => {
                    await save();
                    const renamed = await api<Project>(
                      `/api/projects/${project.id}/name`,
                      "PATCH",
                      { name, baseName: project.name },
                    );
                    editor.mergeName(renamed);
                    setListRefresh((n) => n + 1);
                  }}
                />
                <p>
                  {timeline
                    ? `${timeline.scenes.length} scenes · ${totalFrames(timeline) / 30}s · ${timeline.format} · ${savedVersionCount(project)} saved versions`
                    : "Your director is planning the story…"}
                </p>
              </div>
              <div className="project-heading-actions">
                <button
                  className="subtle"
                  disabled={busy || editor.saving}
                  onClick={() => void trashCurrentProject()}
                >
                  Move project to Trash
                </button>
                <button
                  className="subtle"
                  onClick={() => void navigate(null)}
                  disabled={busy || editor.saving}
                >
                  ← Studio
                </button>
              </div>
            </div>
            {timeline && (
              <fieldset className="editor-content" disabled={busy}>
                <div className="editor-actions">
                  <button
                    className="subtle"
                    disabled={!editor.canUndo || busy}
                    onClick={() => {
                      editor.change("undo");
                      setJob(null);
                    }}
                  >
                    Undo
                  </button>
                  <button
                    className="subtle"
                    disabled={!editor.canRedo || busy}
                    onClick={() => {
                      editor.change("redo");
                      setJob(null);
                    }}
                  >
                    Redo
                  </button>
                  <span role="status" aria-label="Save status">
                    {editor.saving
                      ? "Saving…"
                      : dirty
                        ? "Unsaved changes"
                        : "All changes saved"}
                  </span>
                  <button
                    className="subtle"
                    disabled={!dirty || busy || editor.saving}
                    onClick={() => void run(save)}
                  >
                    Save now
                  </button>
                  <small>
                    Unsaved timeline edits have recovery copies on this device.
                    Signing out clears this account’s copies.
                  </small>
                </div>
                {editor.saveError && (
                  <div className="save-warning" role="alert">
                    <p>{editor.saveError}</p>
                    <button className="subtle" onClick={() => void run(save)}>
                      Retry saving
                    </button>
                    <button
                      className="subtle"
                      onClick={() => {
                        downloadDraft(
                          createBrowserDraft(
                            userId,
                            project,
                            crypto.randomUUID(),
                          ),
                          `reelchemy-draft-${project.id}.json`,
                        );
                      }}
                    >
                      Download unsaved draft
                    </button>
                    <button
                      className="subtle"
                      onClick={() =>
                        void run(async () => {
                          const latest = await api<Project>(
                            `/api/projects/${project.id}`,
                          );
                          // Require an explicit user action before discarding a conflicting draft.
                          if (
                            window.confirm(
                              "Replace your local edits with the latest saved version? Download your draft first if you want to keep it.",
                            )
                          ) {
                            editor.discardDraft();
                            remember(latest);
                            setSelected(0);
                            setJob(null);
                          }
                        })
                      }
                    >
                      Open latest saved version
                    </button>
                  </div>
                )}
                {editor.draftError && (
                  <div className="save-warning" role="alert">
                    <p>{editor.draftError}</p>
                    {!editor.saveError && (
                      <button
                        className="subtle"
                        onClick={() =>
                          downloadDraft(
                            createBrowserDraft(
                              userId,
                              project,
                              crypto.randomUUID(),
                            ),
                            `reelchemy-draft-${project.id}.json`,
                          )
                        }
                      >
                        Download unsaved draft
                      </button>
                    )}
                  </div>
                )}
                <BrowserDraftRecovery
                  drafts={editor.browserDrafts}
                  currentRevisionId={revisionId(project)}
                  disabled={dirty || busy || editor.saving}
                  onRecover={(draft) =>
                    void run(async () => {
                      editor.recoverDraft(draft);
                      setSelected(0);
                      setJob(null);
                    })
                  }
                  onDiscard={(draft) => editor.discardDraft(draft)}
                />
                <div className="work-grid">
                  <section className="preview-panel">
                    <div className="panel-heading">
                      <h2>Live preview</h2>
                      <label>
                        <input
                          aria-label="Preview selected scene only"
                          type="checkbox"
                          checked={scenePreview}
                          onChange={(e) => setScenePreview(e.target.checked)}
                        />{" "}
                        Selected scene only
                      </label>
                      <span>FRAME-ACCURATE · 30 FPS</span>
                    </div>
                    <div className="player-wrap">
                      <Player
                        key={`${scenePreview ? scene?.id : "film"}-${previewStart}`}
                        ref={player}
                        component={Film}
                        inputProps={{
                          timeline,
                          assetSources: Object.fromEntries(
                            (project.assets || []).map((a) => [
                              a.id,
                              `/api/projects/${project.id}/assets/${a.id}`,
                            ]),
                          ),
                        }}
                        initialFrame={
                          previewStart + Math.min(15, previewEnd - previewStart)
                        }
                        inFrame={previewStart}
                        outFrame={previewEnd}
                        loop={scenePreview}
                        durationInFrames={totalFrames(timeline)}
                        fps={30}
                        compositionWidth={formats[timeline.format].width}
                        compositionHeight={formats[timeline.format].height}
                        controls
                        style={{
                          width: "100%",
                          maxHeight: 470,
                          aspectRatio: `${formats[timeline.format].width}/${formats[timeline.format].height}`,
                        }}
                      />
                    </div>
                    <div className="preview-caption">
                      <span>
                        <Icon name="film" size={14} /> Live composition
                      </span>
                      <span>
                        {(timeline.audioTracks?.length || 0) +
                        clipAudioTracks(timeline).length
                          ? "Audio preview"
                          : "Silent preview"}
                      </span>
                    </div>
                  </section>
                  <section className="director-panel">
                    <div className="panel-heading">
                      <h2>
                        <Icon name="sparkle" /> Creative director
                      </h2>
                      <span>DEMO / CONFIGURABLE</span>
                    </div>
                    <CreativeConversation
                      key={`${project.id}:${project.messageCount ?? project.messages.length}`}
                      project={project}
                    />
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        void run(async () => {
                          await save();
                          const p = await api<Project>(
                            `/api/projects/${project.id}/plan`,
                            "POST",
                            {
                              revision,
                              ...(revisionScope === "scene"
                                ? { sceneId: timeline.scenes[selected].id }
                                : {}),
                            },
                          );
                          remember(p);
                          setRevision("");
                          setSelected(0);
                          setJob(null);
                        });
                      }}
                    >
                      <label htmlFor="revision">Describe your revision</label>
                      <select
                        aria-label="Revision scope"
                        value={revisionScope}
                        onChange={(e) => setRevisionScope(e.target.value)}
                      >
                        <option value="scene">Selected scene only</option>
                        <option value="story">Whole storyboard</option>
                      </select>
                      <textarea
                        id="revision"
                        placeholder="Describe a new direction…"
                        value={revision}
                        maxLength={1200}
                        onChange={(e) => setRevision(e.target.value)}
                      />
                      <button
                        className="subtle"
                        disabled={busy || revision.trim().length < 3}
                      >
                        Apply revision <Icon name="arrow-up-right" size={16} />
                      </button>
                    </form>
                  </section>
                </div>
                <TimelineEditor
                  projectId={project.id}
                  assets={project.assets || []}
                  timeline={timeline}
                  selected={selected}
                  onSelect={setSelected}
                  player={player}
                  inFrame={previewStart}
                  outFrame={previewEnd}
                  onChange={changeTimeline}
                />
                <CanvasEditor
                  key={`canvas-${scene?.id}`}
                  timeline={timeline}
                  selected={selected}
                  assetSources={Object.fromEntries(
                    (project.assets || []).map((a) => [
                      a.id,
                      `/api/projects/${project.id}/assets/${a.id}`,
                    ]),
                  )}
                  onChange={changeTimeline}
                />
                <div className="section-heading">
                  <h2>Your storyboard</h2>
                  <span>SELECT A SCENE TO REFINE IT</span>
                </div>
                <div className="storyboard">
                  {timeline.scenes.map((s, i) => (
                    <button
                      key={s.id}
                      className={`scene-card ${selected === i ? "selected" : ""}`}
                      onClick={() => {
                        setSelected(i);
                        player.current?.seekTo(
                          timeline.scenes
                            .slice(0, i)
                            .reduce((n, x) => n + x.durationFrames, 0) + 15,
                        );
                      }}
                    >
                      <div
                        style={{ background: s.background, color: s.accent }}
                      >
                        <span className="scene-number">
                          {String(i + 1).padStart(2, "0")}
                        </span>
                        <strong>
                          {s.layers.find((l) => l.id === "title")?.text ||
                            s.title}
                        </strong>
                        <span className="scene-symbol">
                          <Icon
                            name={
                              s.strategy === "landscape"
                                ? "landscape"
                                : s.strategy === "diagram"
                                  ? "nodes"
                                  : "typography"
                            }
                            size={82}
                          />
                        </span>
                      </div>
                      <footer>
                        <strong>{s.title}</strong>
                        <span>
                          {Number((s.durationFrames / 30).toFixed(1))}s
                        </span>
                      </footer>
                    </button>
                  ))}
                </div>
                {scene && (
                  <section className="scene-editor">
                    <div>
                      <span className="eyebrow">SCENE {selected + 1}</span>
                      <h2>Make it yours.</h2>
                    </div>
                    <label>
                      Scene title
                      <input
                        value={scene.title}
                        maxLength={100}
                        onChange={(e) => changeScene({ title: e.target.value })}
                      />
                    </label>
                    <label>
                      On-screen text
                      <input
                        value={
                          scene.layers.find((l) => l.id === "title")?.text || ""
                        }
                        maxLength={80}
                        onChange={(e) =>
                          changeScene({
                            layers: scene.layers.map((l) =>
                              l.id === "title" && !l.locked
                                ? { ...l, text: e.target.value }
                                : l,
                            ),
                          })
                        }
                      />
                    </label>
                    <label>
                      Accent
                      <input
                        type="color"
                        value={scene.accent}
                        onChange={(e) =>
                          changeScene({
                            accent: e.target.value,
                            layers: scene.layers.map((l) =>
                              l.color === scene.accent && !l.locked
                                ? { ...l, color: e.target.value }
                                : l,
                            ),
                          })
                        }
                      />
                    </label>
                    <div className="reorder">
                      <button
                        aria-label="Move scene earlier"
                        className="subtle"
                        disabled={selected === 0}
                        onClick={() => {
                          const scenes = [...timeline.scenes];
                          [scenes[selected - 1], scenes[selected]] = [
                            scenes[selected],
                            scenes[selected - 1],
                          ];
                          changeTimeline({ ...timeline, scenes });
                          setSelected(selected - 1);
                          setJob(null);
                        }}
                      >
                        <Icon name="arrow-left" size={14} />
                      </button>
                      <button
                        aria-label="Move scene later"
                        className="subtle"
                        disabled={selected === timeline.scenes.length - 1}
                        onClick={() => {
                          const scenes = [...timeline.scenes];
                          [scenes[selected + 1], scenes[selected]] = [
                            scenes[selected],
                            scenes[selected + 1],
                          ];
                          changeTimeline({ ...timeline, scenes });
                          setSelected(selected + 1);
                          setJob(null);
                        }}
                      >
                        <Icon name="arrow-right" size={14} />
                      </button>
                    </div>
                    <button
                      className="subtle"
                      disabled={!dirty || busy}
                      onClick={() => void run(save)}
                    >
                      {dirty ? (
                        "Save changes"
                      ) : (
                        <>
                          Saved <Icon name="check" size={14} />
                        </>
                      )}
                    </button>
                  </section>
                )}
                <section className="scene-editor">
                  <h2>Version history</h2>
                  <select
                    className="version-history-restore"
                    aria-label="Restore saved version"
                    defaultValue=""
                    disabled={
                      busy || dirty || recordingPending || editor.saving
                    }
                    onChange={(e) => {
                      const revisionId = e.target.value;
                      if (!revisionId) return;
                      void run(async () => {
                        remember(
                          await api<Project>(
                            `/api/projects/${project.id}/restore`,
                            "POST",
                            {
                              revisionId,
                              baseRevisionId:
                                project.revisions.at(-1)?.id ?? null,
                            },
                          ),
                        );
                        setSelected(0);
                        setJob(null);
                      });
                      e.target.value = "";
                    }}
                  >
                    <option value="">Choose a saved version to restore…</option>
                    {savedVersionCount(project) > project.revisions.length && (
                      <option disabled>
                        Older versions: choose Browse saved versions below
                      </option>
                    )}
                    {[...project.revisions].reverse().map((r, i) => (
                      <option value={r.id} key={`${r.id}:${i}`}>
                        Version {r.number ?? savedVersionCount(project) - i} ·{" "}
                        {r.source}
                      </option>
                    ))}
                  </select>
                  <small>
                    Restoring saves a new version; earlier versions stay
                    available.
                  </small>
                  <VersionHistory
                    key={`${project.id}:${historyCleanup}`}
                    projectId={project.id}
                    latestRevisionId={revisionId(project)}
                    count={savedVersionCount(project)}
                    disabled={busy || recordingPending}
                    canRestore={
                      !busy && !dirty && !recordingPending && !editor.saving
                    }
                    onOpen={() => player.current?.pause()}
                    onRestored={(saved) => {
                      remember(saved);
                      setSelected(0);
                      setJob(null);
                    }}
                  />
                  <ProjectHistoryStorage
                    key={project.id}
                    projectId={project.id}
                    latestRevisionId={revisionId(project)}
                    disabled={busy || recordingActive || editor.saving}
                    onOpen={() => player.current?.pause()}
                    onHistory={(fresh, expected) => {
                      const merged = editor.mergeHistory(fresh, expected);
                      if (merged) {
                        setHistoryCleanup((n) => n + 1);
                        setListRefresh((n) => n + 1);
                      }
                      return merged;
                    }}
                  />
                </section>
                <section className="scene-editor">
                  <h2>Keep your project</h2>
                  <label>
                    Recover a downloaded draft
                    <input
                      type="file"
                      accept="application/json,.json"
                      aria-label="Recover a downloaded draft"
                      disabled={busy || dirty || editor.saving}
                      onChange={(e) => {
                        const file = e.currentTarget.files?.[0];
                        e.currentTarget.value = "";
                        if (!file) return;
                        void run(async () => {
                          if (file.size > MAX_DOWNLOADED_DRAFT_BYTES)
                            throw new Error(
                              "Recovery files must be 2 MiB or smaller.",
                            );
                          const draft = parseDownloadedDraft(
                            await file.text(),
                            userId,
                            project.id,
                          );
                          if (!confirmDraftRecovery(draft, revisionId(project)))
                            return;
                          editor.recoverDraft(draft);
                          setSelected(0);
                          setJob(null);
                        });
                      }}
                    />
                  </label>
                  <small>
                    Use a recovery JSON from this account and project. Saved
                    versions remain available; the original uploaded media must
                    still be in the project.
                  </small>
                  <DownloadProject
                    key={project.id}
                    projectId={project.id}
                    disabled={busy || recordingPending || editor.saving}
                    beforeDownload={async () => {
                      if (dirty) await save();
                    }}
                  />
                  <small>
                    ZIP includes saved scenes, conversation, versions, and
                    uploaded assets. Import creates a separate copy. Edits made
                    while downloading stay in your current project.
                  </small>
                </section>
                <AssetPanel
                  key={project.id}
                  canAddVisual={!!scene && scene.layers.length < 20}
                  onRecordingPending={setRecordingPending}
                  onRecordingActive={setRecordingActive}
                  onRecordStart={() => player.current?.pause()}
                  project={project}
                  onProject={editor.mergeAssets}
                  onAdd={(assetId) => {
                    if (!scene) return;
                    const asset = project.assets?.find((a) => a.id === assetId);
                    const video = asset?.mime === "video/mp4";
                    const layer: Layer = {
                      id: crypto.randomUUID(),
                      kind: video ? "video" : "image",
                      assetId,
                      x: video ? 0 : 0.1,
                      y: video ? 0 : 0.5,
                      width: video ? 1 : 0.8,
                      height: video ? 1 : 0.35,
                      text: "",
                      color: "#FFFFFF",
                      fontSize: 48,
                      animation: video ? "none" : "rise",
                      ...(video
                        ? {
                            video: {
                              startFrame: 0,
                              offsetFrames: 0,
                              durationFrames: Math.min(
                                scene.durationFrames,
                                asset.durationFrames || 1,
                              ),
                              volume: 1,
                              audio: !!asset.hasAudio,
                              fit: "contain" as const,
                            },
                          }
                        : {}),
                    };
                    changeScene({
                      layers: video
                        ? [layer, ...scene.layers]
                        : [...scene.layers, layer],
                    });
                  }}
                />
                <LayerEditor
                  key={`layers-${scene?.id}`}
                  assets={project.assets || []}
                  timeline={timeline}
                  selected={Math.min(selected, timeline.scenes.length - 1)}
                  onChange={changeTimeline}
                />
                <MediaEditor
                  timeline={timeline}
                  assets={project.assets || []}
                  onChange={changeTimeline}
                />
                <section className="export-panel">
                  <div>
                    <span className="eyebrow">READY WHEN YOU ARE</span>
                    <h2>Bring your story to life.</h2>
                    <p>
                      H.264 MP4 · Technical checks · Scene snapshots & motion
                      clips
                    </p>
                  </div>
                  <button
                    className="primary"
                    disabled={busy || !!active}
                    onClick={() =>
                      void run(async () => {
                        await save();
                        const saved = editor.getCurrent();
                        if (!saved || saved.id !== project.id)
                          throw new Error(
                            "Open the project again before exporting.",
                          );
                        const version = revisionId(saved);
                        if (
                          pendingExport.current?.projectId !== saved.id ||
                          pendingExport.current.revisionId !== version
                        )
                          pendingExport.current = {
                            projectId: saved.id,
                            revisionId: version,
                            key: crypto.randomUUID(),
                          };
                        setJob(
                          await api<RenderJob>(
                            `/api/projects/${project.id}/render`,
                            "POST",
                            { baseRevisionId: version },
                            { "Idempotency-Key": pendingExport.current.key },
                          ),
                        );
                        pendingExport.current = null;
                      })
                    }
                  >
                    {active ? "Rendering…" : "Approve & export MP4"}{" "}
                    <Icon name="arrow-up-right" size={18} />
                  </button>
                </section>
                <ExportHistory
                  projectId={project.id}
                  current={job}
                  onSelect={setJob}
                />
                {job && (
                  <section className="job-panel" aria-live="polite">
                    <div className="job-heading">
                      <strong>
                        {job.files
                          ? "Export files unavailable"
                          : job.status === "completed"
                            ? "Your film is ready."
                            : job.status === "failed"
                              ? "Export needs attention"
                              : job.status === "cancelled"
                                ? "Export cancelled"
                                : job.status === "queued"
                                  ? "Waiting for the render worker…"
                                  : `${job.stage || "Rendering your story"} · ${Math.round(job.progress * 100)}%`}
                      </strong>
                      {active && (
                        <button
                          className="subtle"
                          onClick={() =>
                            void run(async () =>
                              setJob(
                                await api<RenderJob>(
                                  `/api/jobs/${job.id}`,
                                  "DELETE",
                                ),
                              ),
                            )
                          }
                        >
                          Cancel export
                        </button>
                      )}
                    </div>
                    <progress max={1} value={job.progress} />
                    <details>
                      <summary>
                        Export activity
                        {job.retryCount ? ` · ${job.retryCount} retry` : ""}
                      </summary>
                      {job.events?.map((event, index) => (
                        <p key={index}>
                          {event.at.slice(11, 19)} UTC · {event.message}
                        </p>
                      ))}
                    </details>
                    {!active && (
                      <ExportFiles
                        job={job}
                        onChange={(files) =>
                          setJob((current) =>
                            current?.id === job.id
                              ? { ...current, files }
                              : current,
                          )
                        }
                      />
                    )}
                    {job.error && <p role="alert">{job.error}</p>}
                    {job.status === "queued" && (
                      <p>
                        Keep the render worker running alongside the web app.
                      </p>
                    )}
                    {job.status === "completed" && !job.files && (
                      <>
                        <div className="completed-export">
                          <img
                            src={`/api/jobs/${job.id}/thumbnail`}
                            alt="Rendered video thumbnail"
                          />
                          <div>
                            <p>
                              Verified codec, dimensions, frame rate, and
                              duration.
                            </p>
                            <a
                              className="primary download"
                              href={`/api/jobs/${job.id}/download`}
                            >
                              Download MP4 <Icon name="download" size={14} />
                            </a>
                            {((job.report as { timeline?: Timeline } | null)
                              ?.timeline?.captions?.length || 0) > 0 && (
                              <div className="layer-fields">
                                <a
                                  href={`/api/jobs/${job.id}/evidence/captions.srt`}
                                  download="captions.srt"
                                >
                                  SRT captions{" "}
                                  <Icon name="download" size={14} />
                                </a>
                                <a
                                  href={`/api/jobs/${job.id}/evidence/captions.vtt`}
                                  download="captions.vtt"
                                >
                                  VTT captions{" "}
                                  <Icon name="download" size={14} />
                                </a>
                              </div>
                            )}
                          </div>
                        </div>
                        <QualityEvidence job={job} />
                        <p className="qc-note">
                          Static geometry and rendered text checks completed.
                          Scene stills and moving clips are stored with the
                          export for review. Semantic quality and perceptual
                          audio/video sync require human review.
                        </p>
                      </>
                    )}
                  </section>
                )}
              </fieldset>
            )}
          </div>
        )}
        {error && (
          <div className="error-banner" role="alert" aria-label="Studio error">
            <strong>Something needs attention.</strong> {error}
            <button aria-label="Dismiss error" onClick={() => setError("")}>
              <Icon name="close" size={16} />
            </button>
          </div>
        )}
        <footer className="main-footer">
          <span>
            <Icon name="sparkle" size={14} /> Reelchemy
          </span>
          <span>Ideas deserve to move.</span>
        </footer>
      </main>
    </div>
  );
}
