"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Player, type PlayerRef } from "@remotion/player";
import { Film } from "@/video/Composition";
import {
  formats,
  totalFrames,
  type Project,
  type RenderJob,
  type Timeline,
} from "@/lib/schema";
const ideas = [
  {
    icon: "↗",
    tag: "EXPLAINER",
    title: "Make the complex, clear.",
    prompt: "Explain how a small idea grows into something extraordinary.",
  },
  {
    icon: "☼",
    tag: "STORY",
    title: "Build a world worth watching.",
    prompt:
      "A quiet journey through an imaginary mountain landscape at sunrise.",
  },
  {
    icon: "✳",
    tag: "PROMO",
    title: "Give your next launch a little magic.",
    prompt: "A bold, minimal launch film for a new creative notebook.",
  },
];
async function api<T>(url: string, method = "GET", data?: unknown): Promise<T> {
  const r = await fetch(url, {
    method,
    headers: data ? { "Content-Type": "application/json" } : undefined,
    body: data ? JSON.stringify(data) : undefined,
  });
  const result = await r.json();
  if (!r.ok) throw new Error(result.error || "Request failed");
  return result;
}
export function Studio() {
  const [projects, setProjects] = useState<Project[]>([]),
    [project, setProject] = useState<Project | null>(null),
    [prompt, setPrompt] = useState(""),
    [duration, setDuration] = useState(15),
    [format, setFormat] = useState<Timeline["format"]>("landscape");
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [job, setJob] = useState<RenderJob | null>(null),
    [selected, setSelected] = useState(0),
    [dirty, setDirty] = useState(false),
    [revision, setRevision] = useState("");
  const player = useRef<PlayerRef>(null);
  useEffect(() => {
    api<Project[]>("/api/projects")
      .then(setProjects)
      .catch((e) => setError(e.message))
      .finally(() => setReady(true));
  }, []);
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
  }, [job]);
  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }
  function remember(p: Project) {
    setProject(p);
    setProjects((old) => [p, ...old.filter((x) => x.id !== p.id)]);
  }
  async function create() {
    await run(async () => {
      let p = await api<Project>("/api/projects", "POST", {
        prompt,
        duration,
        format,
      });
      remember(p);
      p = await api<Project>(`/api/projects/${p.id}/plan`, "POST", {});
      remember(p);
      setSelected(0);
      setJob(null);
      setDirty(false);
    });
  }
  async function save() {
    if (!project?.timeline) return;
    const p = await api<Project>(
      `/api/projects/${project.id}`,
      "PATCH",
      project.timeline,
    );
    remember(p);
    setDirty(false);
  }
  function changeScene(update: Partial<Timeline["scenes"][number]>) {
    if (!project?.timeline) return;
    setProject({
      ...project,
      timeline: {
        ...project.timeline,
        scenes: project.timeline.scenes.map((s, i) =>
          i === selected ? { ...s, ...update } : s,
        ),
      },
    });
    setDirty(true);
    setJob(null);
  }
  const timeline = project?.timeline,
    scene = timeline?.scenes[selected];
  const active = job && ["queued", "rendering"].includes(job.status);
  return (
    <div className="shell">
      <aside className="sidebar">
        <Link className="wordmark" href="/" aria-label="Reelchemy home">
          <span className="brand-icon">
            r<span>✳</span>
          </span>
          reelchemy<span className="beta">BETA</span>
        </Link>
        <button
          className="new-project"
          onClick={() => {
            setProject(null);
            setJob(null);
            setError("");
            setDirty(false);
          }}
        >
          ＋ <span>New creation</span>
          <kbd>↵</kbd>
        </button>
        <div className="nav-label">YOUR WORKSPACE</div>
        <button
          className={`nav-item ${!project ? "current" : ""}`}
          onClick={() => {
            setProject(null);
            setJob(null);
          }}
        >
          ▦ <span>Studio</span>
          <span className="count">{projects.length}</span>
        </button>
        <div className="recent-label">RECENT PROJECTS</div>
        <div className="project-list">
          {projects.length ? (
            projects.map((p) => (
              <button
                key={p.id}
                className={`project-item ${project?.id === p.id ? "chosen" : ""}`}
                onClick={() => {
                  remember(p);
                  setSelected(0);
                  setJob(null);
                  setDirty(false);
                  setError("");
                }}
              >
                <span>▱</span>
                <span>{p.name}</span>
              </button>
            ))
          ) : (
            <p className="empty-recent">
              Your next great idea
              <br />
              starts here.
            </p>
          )}
        </div>
        <div className="sidebar-bottom">
          <div className="mode-dot" />
          Local creative workspace<p>No-key demo available</p>
          <div className="profile">
            <span className="avatar">Y</span>
            <div>
              Your workspace<small>Personal studio</small>
            </div>
            <span>⌘</span>
          </div>
        </div>
      </aside>
      <main>
        <header className="topbar">
          <div>
            Workspace <span>/</span>{" "}
            <strong>{project ? "Project studio" : "Studio"}</strong>
          </div>
          <span className="private">
            <span>◉</span> Local workspace
          </span>
        </header>
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
                <span>✳</span> What are we creating today?
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
                    <span>▭</span>
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
                    <span>◷</span>
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
                  {busy ? "Planning…" : "Create storyboard"} <span>↗</span>
                </button>
              </div>
            </form>
            <div className="composer-note">
              <span>✧</span> Demo director · Procedural animation · You approve
              before export
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
                    <span>{idea.icon}</span>
                    {i === 1 && <div className="hills" />}
                  </div>
                  <div className="idea-content">
                    <small>{idea.tag}</small>
                    <h3>{idea.title}</h3>
                    <span className="idea-arrow">↗</span>
                  </div>
                </button>
              ))}
            </div>
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
                <p>
                  {timeline
                    ? `${timeline.scenes.length} scenes · ${totalFrames(timeline) / 30}s · ${timeline.format} · ${project.revisions.length} saved versions`
                    : "Your director is planning the story…"}
                </p>
              </div>
              <button
                className="subtle"
                onClick={() => {
                  setProject(null);
                  setJob(null);
                }}
              >
                ← Studio
              </button>
            </div>
            {timeline && (
              <>
                <div className="work-grid">
                  <section className="preview-panel">
                    <div className="panel-heading">
                      <h2>Live preview</h2>
                      <span>FRAME-ACCURATE · 30 FPS</span>
                    </div>
                    <div className="player-wrap">
                      <Player
                        ref={player}
                        component={Film}
                        inputProps={{ timeline }}
                        initialFrame={15}
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
                      <span>◉ Procedural composition</span>
                      <span>Silent preview</span>
                    </div>
                  </section>
                  <section className="director-panel">
                    <div className="panel-heading">
                      <h2>
                        <span>✳</span> Creative director
                      </h2>
                      <span>DEMO / CONFIGURABLE</span>
                    </div>
                    <div className="conversation">
                      {project.messages.map((m, i) => (
                        <div key={i} className={`message ${m.role}`}>
                          <small>
                            {m.role === "user" ? "YOU" : "DIRECTOR"}
                          </small>
                          <p>{m.content}</p>
                        </div>
                      ))}
                    </div>
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        void run(async () => {
                          const p = await api<Project>(
                            `/api/projects/${project.id}/plan`,
                            "POST",
                            { revision },
                          );
                          remember(p);
                          setRevision("");
                          setSelected(0);
                          setDirty(false);
                          setJob(null);
                        });
                      }}
                    >
                      <label htmlFor="revision">Reimagine this story</label>
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
                        Revise storyboard ↗
                      </button>
                    </form>
                  </section>
                </div>
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
                          {s.strategy === "landscape"
                            ? "△"
                            : s.strategy === "diagram"
                              ? "⌘"
                              : "◉"}
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
                              l.id === "title"
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
                              l.color === scene.accent
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
                          setProject({
                            ...project,
                            timeline: { ...timeline, scenes },
                          });
                          setSelected(selected - 1);
                          setDirty(true);
                          setJob(null);
                        }}
                      >
                        ←
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
                          setProject({
                            ...project,
                            timeline: { ...timeline, scenes },
                          });
                          setSelected(selected + 1);
                          setDirty(true);
                          setJob(null);
                        }}
                      >
                        →
                      </button>
                    </div>
                    <button
                      className="subtle"
                      disabled={!dirty || busy}
                      onClick={() => void run(save)}
                    >
                      {dirty ? "Save changes" : "Saved ✓"}
                    </button>
                  </section>
                )}
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
                        if (dirty) await save();
                        setJob(
                          await api<RenderJob>(
                            `/api/projects/${project.id}/render`,
                            "POST",
                          ),
                        );
                      })
                    }
                  >
                    {active ? "Rendering…" : "Approve & export MP4"}{" "}
                    <span>↗</span>
                  </button>
                </section>
                {job && (
                  <section className="job-panel" aria-live="polite">
                    <div className="job-heading">
                      <strong>
                        {job.status === "completed"
                          ? "Your film is ready."
                          : job.status === "failed"
                            ? "Export needs attention"
                            : job.status === "cancelled"
                              ? "Export cancelled"
                              : job.status === "queued"
                                ? "Waiting for the render worker…"
                                : `Rendering your story · ${Math.round(job.progress * 100)}%`}
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
                    {job.error && <p role="alert">{job.error}</p>}
                    {job.status === "queued" && (
                      <p>
                        Keep the render worker running alongside the web app.
                      </p>
                    )}
                    {job.status === "completed" && (
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
                              Download MP4 ↓
                            </a>
                          </div>
                        </div>
                        <p className="qc-note">
                          Layout checks completed. Scene stills and moving clips
                          are stored with the export for review. Semantic,
                          motion, and audio quality have not been automatically
                          reviewed.
                        </p>
                      </>
                    )}
                  </section>
                )}
              </>
            )}
          </div>
        )}
        {error && (
          <div className="error-banner" role="alert">
            <strong>Something needs attention.</strong> {error}
            <button aria-label="Dismiss error" onClick={() => setError("")}>
              ×
            </button>
          </div>
        )}
        <footer className="main-footer">
          <span>✳ Reelchemy</span>
          <span>Ideas deserve to move.</span>
        </footer>
      </main>
    </div>
  );
}
