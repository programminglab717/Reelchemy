"use client";
const tools = [
  ["preview", "Preview"],
  ["timeline", "Timeline"],
  ["canvas", "Canvas"],
  ["scene", "Scene & notes"],
  ["media", "Media & voice"],
  ["captions", "Sound & captions"],
  ["export", "Export"],
] as const;
function jump(id: string) {
  const target = document.getElementById(id);
  target?.focus({ preventScroll: true });
  target?.scrollIntoView({ block: "start", behavior: "auto" });
}
export function EditorToolsNav() {
  return (
    <nav className="editor-shortcuts" aria-label="Editing tools">
      <div className="editor-tool-links">
        {tools.map(([key, label]) => (
          <a
            key={key}
            href={`#studio-tool-${key}`}
            onClick={(event) => {
              event.preventDefault();
              jump(`studio-tool-${key}`);
            }}
          >
            {label}
          </a>
        ))}
      </div>
      <label className="mobile-tool-picker">
        Editing tools
        <select
          aria-label="Jump to editing tool"
          defaultValue=""
          onChange={(event) => {
            jump(event.target.value);
            event.currentTarget.value = "";
          }}
        >
          <option value="" disabled>
            Jump to a tool…
          </option>
          {tools.map(([key, label]) => (
            <option key={key} value={`studio-tool-${key}`}>
              {label}
            </option>
          ))}
        </select>
      </label>
    </nav>
  );
}
