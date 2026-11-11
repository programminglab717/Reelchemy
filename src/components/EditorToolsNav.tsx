"use client";
// The editor's tools beside the player and timeline, one open at a time.
export const studioTools = [
  ["director", "Director", "studio-tool-director"],
  ["scene", "Scene & layers", "studio-tool-scene"],
  ["design", "Design", "studio-tool-canvas"],
  ["media", "Media & voice", "studio-tool-media"],
  ["captions", "Sound & captions", "studio-tool-captions"],
  ["export", "Export", "studio-tool-export"],
  ["project", "Project", "studio-tool-project"],
] as const;
export type StudioTool = (typeof studioTools)[number][0];
export function EditorToolsNav({
  tool,
  onTool,
}: {
  tool: StudioTool;
  onTool: (tool: StudioTool) => void;
}) {
  const select = (next: StudioTool) => {
    onTool(next);
    requestAnimationFrame(() =>
      document.getElementById(`studio-tab-${next}`)?.focus(),
    );
  };
  return (
    <div className="editor-shortcuts">
      <div
        className="editor-tool-links"
        role="tablist"
        aria-label="Editing tools"
        onKeyDown={(event) => {
          const index = studioTools.findIndex(([key]) => key === tool);
          const step =
            event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
          if (!step) return;
          event.preventDefault();
          select(
            studioTools[
              (index + step + studioTools.length) % studioTools.length
            ][0],
          );
        }}
      >
        {studioTools.map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            id={`studio-tab-${key}`}
            aria-selected={tool === key}
            aria-controls={`studio-panel-${key}`}
            tabIndex={tool === key ? 0 : -1}
            className={tool === key ? "active" : ""}
            onClick={() => onTool(key)}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}
