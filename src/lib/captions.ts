import type { Timeline } from "./schema";
export function captionAt(t: Timeline, frame: number) {
  return t.captions?.find((c) => frame >= c.startFrame && frame < c.endFrame);
}
function timestamp(frame: number, separator: string) {
  const ms = Math.round((frame * 1000) / 30),
    h = Math.floor(ms / 3600000),
    m = Math.floor(ms / 60000) % 60,
    s = Math.floor(ms / 1000) % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}${separator}${String(ms % 1000).padStart(3, "0")}`;
}
export function subtitles(t: Timeline, format: "srt" | "vtt") {
  const escape = (text: string) =>
    text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return (
    (format === "vtt" ? "WEBVTT\n\n" : "") +
    [...(t.captions || [])]
      .sort((a, b) => a.startFrame - b.startFrame)
      .map(
        (c, i) =>
          `${i + 1}\n${timestamp(c.startFrame, format === "srt" ? "," : ".")} --> ${timestamp(c.endFrame, format === "srt" ? "," : ".")}\n${escape(c.text)}\n`,
      )
      .join("\n")
  );
}
