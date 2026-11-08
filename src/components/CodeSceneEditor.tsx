"use client";
import { useEffect, useState } from "react";
import { motionCodeSchema, type Timeline } from "@/lib/schema";
import type { MotionCode } from "@/motion/document";
import { starterCode } from "@/motion/starter";

const parts = [
  ["js", "JavaScript"],
  ["html", "HTML"],
  ["css", "CSS"],
] as const;

// Identifies a version of a scene's code, so the editor starts over when the
// code changes from elsewhere (the director, version history).
export function codeVersion(code: MotionCode) {
  let hash = 0x811c9dc5;
  const text = JSON.stringify(code);
  for (let i = 0; i < text.length; i++)
    hash = Math.imul(hash ^ text.charCodeAt(i), 0x01000193);
  return (hash >>> 0).toString(36);
}

// Edit an animated code scene's HTML, CSS and JavaScript. Changes apply to the
// film (and autosave) when the maker applies them; errors the scene throws in
// the player are shown here.
export function CodeSceneEditor({
  timeline,
  selected,
  onChange,
}: {
  timeline: Timeline;
  selected: number;
  onChange: (timeline: Timeline) => void;
}) {
  const scene = timeline.scenes[selected];
  const saved = scene.code!;
  const [draft, setDraft] = useState<MotionCode>(saved);
  const [part, setPart] = useState<(typeof parts)[number][0]>("js");
  const [problem, setProblem] = useState<string | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  useEffect(() => {
    const listen = (event: Event) => {
      const detail = (
        event as CustomEvent<{ sceneId: string; message: string }>
      ).detail;
      if (detail?.sceneId !== scene.id) return;
      setErrors((list) =>
        list.includes(detail.message)
          ? list
          : [...list, detail.message].slice(-5),
      );
    };
    window.addEventListener("reelchemy:code-scene-error", listen);
    return () =>
      window.removeEventListener("reelchemy:code-scene-error", listen);
  }, [scene.id]);
  const changed =
    draft.html !== saved.html ||
    draft.css !== saved.css ||
    draft.js !== saved.js ||
    !!draft.libraries?.length !== !!saved.libraries?.length ||
    !!draft.fit !== !!saved.fit;
  function apply() {
    const parsed = motionCodeSchema.safeParse(draft);
    if (!parsed.success) {
      setProblem(
        parsed.error.issues
          .map((issue) => `${issue.path.join(".") || "code"}: ${issue.message}`)
          .join(" "),
      );
      return;
    }
    setProblem(null);
    setErrors([]);
    onChange({
      ...timeline,
      scenes: timeline.scenes.map((s, i) =>
        i === selected ? { ...s, code: parsed.data } : s,
      ),
    });
  }
  return (
    <section
      id="studio-tool-canvas"
      tabIndex={-1}
      className="code-scene-editor layer-editor"
      aria-label={`Code of scene ${selected + 1}`}
    >
      <div className="panel-heading">
        <h2>Code of scene {selected + 1}</h2>
        <span className="code-scene-badge">HTML · CSS · GSAP</span>
      </div>
      <p className="code-scene-help">
        This scene is animated in code on a {stageSize(timeline.format)} stage.
        Edit it here, or describe a change below and the AI director rewrites
        it.
      </p>
      <div className="code-tabs" role="tablist" aria-label="Scene code part">
        {parts.map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={part === key}
            className={part === key ? "selected" : ""}
            onClick={() => setPart(key)}
          >
            {label}
          </button>
        ))}
      </div>
      <textarea
        className="code-input"
        aria-label={`Scene ${parts.find(([key]) => key === part)![1]}`}
        spellCheck={false}
        autoCapitalize="off"
        autoComplete="off"
        wrap="off"
        rows={18}
        value={draft[part]}
        onChange={(e) => setDraft({ ...draft, [part]: e.target.value })}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            if (changed) apply();
          } else if (e.key === "Tab" && !e.shiftKey) {
            e.preventDefault();
            const t = e.currentTarget,
              start = t.selectionStart,
              end = t.selectionEnd;
            const value = t.value.slice(0, start) + "  " + t.value.slice(end);
            setDraft({ ...draft, [part]: value });
            requestAnimationFrame(() =>
              t.setSelectionRange(start + 2, start + 2),
            );
          }
        }}
      />
      <label className="code-libraries">
        <input
          type="checkbox"
          checked={!!draft.libraries?.includes("d3")}
          onChange={(e) => {
            const { libraries: _omit, ...rest } = draft;
            void _omit;
            setDraft(e.target.checked ? { ...rest, libraries: ["d3"] } : rest);
          }}
        />{" "}
        Load d3 for this scene
      </label>
      {draft.fit && (
        <p className="code-fit" aria-label="Fitted to frame">
          Scaled to {Math.round(draft.fit.scale * 100)}% so the finished
          composition fits the frame.{" "}
          <button
            type="button"
            className="subtle"
            onClick={() => {
              const { fit: _omit, ...rest } = draft;
              void _omit;
              setDraft(rest);
            }}
          >
            Show at full size
          </button>
        </p>
      )}
      {problem && (
        <p className="error" role="alert">
          {problem}
        </p>
      )}
      {errors.length > 0 && (
        <div className="code-errors" role="alert" aria-label="Scene errors">
          <strong>The scene reported an error in the player</strong>
          {errors.map((message) => (
            <pre key={message}>
              {message.split("\n").slice(0, 4).join("\n")}
            </pre>
          ))}
        </div>
      )}
      <div className="code-actions">
        <button
          type="button"
          className="primary"
          disabled={!changed}
          onClick={apply}
        >
          Apply code
        </button>
        <button
          type="button"
          className="subtle"
          disabled={!changed}
          onClick={() => {
            setDraft(saved);
            setProblem(null);
          }}
        >
          Revert
        </button>
        <small>Ctrl/⌘ + Enter applies. Version history keeps every save.</small>
      </div>
      <details className="code-reference">
        <summary>Kit reference</summary>
        <ul>
          <li>
            <code>R.theme(&#123;background, accents&#125;)</code>,{" "}
            <code>R.node(&#123;x, y, label, sub, icon&#125;)</code>,{" "}
            <code>R.icon(name)</code>
          </li>
          <li>
            <code>R.connect(a, b, &#123;curve, arrow&#125;).draw()</code>,{" "}
            <code>R.flow(link, &#123;count, duration&#125;)</code>,{" "}
            <code>R.ring(target)</code>, <code>R.line(points)</code>
          </li>
          <li>
            <code>R.code(el, source, &#123;lang&#125;).type()</code>,{" "}
            <code>R.count(el, to)</code>, <code>R.bars(&#123;data&#125;)</code>
          </li>
          <li>
            <code>R.focus(world, target, &#123;scale&#125;)</code>,{" "}
            <code>R.grid()</code>, <code>R.glow()</code>,{" "}
            <code>R.particles()</code>
          </li>
          <li>
            GSAP 3 with SplitText, DrawSVG, MorphSVG, MotionPath, ScrambleText
            and CustomEase. Build one timeline from time 0; time is virtual, so
            every exported frame is exact.
          </li>
        </ul>
      </details>
    </section>
  );
}
function stageSize(format: Timeline["format"]) {
  return format === "portrait"
    ? "1080×1920"
    : format === "square"
      ? "1080×1080"
      : "1920×1080";
}

// Offered for layered scenes: replace the layers with a starter code scene.
export function CodeSceneConvert({
  timeline,
  selected,
  onChange,
}: {
  timeline: Timeline;
  selected: number;
  onChange: (timeline: Timeline) => void;
}) {
  const scene = timeline.scenes[selected];
  return (
    <div className="code-scene-convert">
      <span>
        Want full control? Write this scene as an HTML, CSS and GSAP animation.
      </span>
      <button
        type="button"
        className="subtle"
        onClick={() => {
          if (
            !window.confirm(
              "Replace this scene's layers with a code animation? Version history keeps the current version.",
            )
          )
            return;
          onChange({
            ...timeline,
            scenes: timeline.scenes.map((s, i) =>
              i === selected
                ? {
                    ...s,
                    layers: [],
                    code: starterCode({
                      title:
                        scene.layers.find((l) => l.id === "title")?.text ||
                        scene.title,
                      background: scene.background,
                      accent: scene.accent,
                      format: timeline.format,
                    }),
                  }
                : s,
            ),
          });
        }}
      >
        Write scene in code
      </button>
    </div>
  );
}
