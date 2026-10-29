import {
  captionSchema,
  timelineSchema,
  type Caption,
  type Timeline,
} from "./schema";

export const MAX_SUBTITLE_BYTES = 64 * 1024;

// A deliberately bounded plain-text SRT/WebVTT importer. Unsupported positioning,
// styling and embedded timestamps fail explicitly instead of silently changing them.
export function parseSubtitles(
  input: string,
  format: "srt" | "vtt",
): Caption[] {
  if (new TextEncoder().encode(input).length > MAX_SUBTITLE_BYTES)
    throw new Error("Subtitle files must be 64 KB or smaller.");
  const text = input
    .replace(/^\uFEFF/, "")
    .replace(/\r\n?/g, "\n")
    .trim();
  const blocks = text.split(/\n[ \t]*\n/);
  if (format === "vtt") {
    if (!/^WEBVTT(?:[ \t].*)?$/.test(blocks.shift() || ""))
      throw new Error("WebVTT files must start with WEBVTT and a blank line.");
  }
  const cues: Caption[] = [];
  function frame(value: string) {
    const pattern =
      format === "srt"
        ? /^(\d{2,}):(\d{2}):(\d{2}),(\d{3})$/
        : /^(?:(\d{2,}):)?(\d{2}):(\d{2})\.(\d{3})$/;
    const match = value.match(pattern);
    if (!match || Number(match[2]) > 59 || Number(match[3]) > 59)
      throw new Error(`Invalid ${format.toUpperCase()} timestamp: ${value}`);
    const ms =
      ((Number(match[1] || 0) * 60 + Number(match[2])) * 60 +
        Number(match[3])) *
        1000 +
      Number(match[4]);
    if (!Number.isSafeInteger(ms) || ms > 60000)
      throw new Error(
        "Subtitle times must fit the current 60-second project limit.",
      );
    return Math.round((ms * 30) / 1000);
  }
  for (const block of blocks) {
    if (!block.trim()) continue;
    if (format === "vtt" && /^NOTE(?:[ \t\n]|$)/.test(block)) continue;
    const lines = block.split("\n");
    if (!lines[0].includes("-->")) lines.shift(); // Optional cue identifier.
    const timing = lines.shift()?.match(/^(\S+)\s+-->\s+(\S+)\s*$/);
    if (!timing)
      throw new Error(
        "Use plain subtitle cues with one start --> end timing line. Cue settings, STYLE and REGION blocks are not supported.",
      );
    let content = lines.join(" ").trim();
    // Preserve our exported literal <text> by stripping formatting before decoding entities.
    content = content.replace(
      /<\/?(?:b|i|u|c(?:\.[\w-]+)*|v(?:\s+[^<>]+)?|lang(?:\s+[^<>]+)?)>/g,
      "",
    );
    if (/<[^>]*>/.test(content))
      throw new Error(
        "Unsupported subtitle markup. Import plain text without embedded timestamps or custom tags.",
      );
    content = content.replace(
      /&(amp|lt|gt|quot|apos|nbsp|#\d+|#x[\da-f]+);/gi,
      (entity, code: string) => {
        const named: Record<string, string> = {
          amp: "&",
          lt: "<",
          gt: ">",
          quot: '"',
          apos: "'",
          nbsp: " ",
        };
        const lower = code.toLowerCase();
        if (named[lower]) return named[lower];
        const point = Number.parseInt(
          lower.slice(lower.startsWith("#x") ? 2 : 1),
          lower.startsWith("#x") ? 16 : 10,
        );
        return point > 0 &&
          point <= 0x10ffff &&
          !(point >= 0xd800 && point <= 0xdfff)
          ? String.fromCodePoint(point)
          : entity;
      },
    );
    const parsed = captionSchema.safeParse({
      id: crypto.randomUUID(),
      startFrame: frame(timing[1]),
      endFrame: frame(timing[2]),
      text: content,
    });
    if (!parsed.success)
      throw new Error(
        `Cue ${cues.length + 1} needs 1–80 characters of text and valid timing.`,
      );
    cues.push(parsed.data);
    if (cues.length > 100) throw new Error("Import at most 100 subtitle cues.");
  }
  if (!cues.length) throw new Error("No subtitle cues found.");
  return cues.sort((a, b) => a.startFrame - b.startFrame);
}

export function importCaptions(
  timeline: Timeline,
  cues: Caption[],
  mode: "replace" | "merge",
): Timeline {
  const result = timelineSchema.safeParse({
    ...timeline,
    captions: [
      ...(mode === "merge" ? timeline.captions || [] : []),
      ...cues,
    ].sort((a, b) => a.startFrame - b.startFrame),
  });
  if (!result.success)
    throw new Error(
      "Imported captions must fit this video, have at least one frame per cue, contain at most 100 cues, and not overlap existing or imported cues.",
    );
  return result.data;
}
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
