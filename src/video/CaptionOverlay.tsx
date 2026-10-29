import React from "react";
import { captionStyleSchema, formats, type Timeline } from "../lib/schema";

// Shared by the preview, export and Chromium layout checks. Values are relative
// to the output geometry, so square and portrait exports use the same safe area.
export function CaptionOverlay({
  timeline,
  text,
  id,
}: {
  timeline: Timeline;
  text: string;
  id: string;
}) {
  const style = timeline.captionStyle || captionStyleSchema.parse({});
  const size = formats[timeline.format];
  const scale = Math.min(size.width, size.height) / 720;
  const fonts = {
    sans: "Arial, sans-serif",
    serif: "Georgia, serif",
    mono: "'Courier New', monospace",
  };
  return (
    <div
      style={{
        position: "absolute",
        left: "8%",
        width: "84%",
        height: "32%",
        ...(style.position === "middle"
          ? { top: "34%" }
          : {
              [style.position === "top" ? "top" : "bottom"]: `${style.margin}%`,
            }),
        display: "flex",
        flexDirection: "column",
        justifyContent:
          style.position === "top"
            ? "flex-start"
            : style.position === "middle"
              ? "center"
              : "flex-end",
        pointerEvents: "none",
      }}
    >
      <div
        data-caption-id={id}
        style={{
          boxSizing: "border-box",
          width: "100%",
          maxHeight: "100%",
          flexShrink: 0,
          overflow: "hidden",
          fontFamily: fonts[style.fontFamily],
          fontSize: style.fontSize * scale,
          fontWeight: style.bold ? 700 : 400,
          lineHeight: 1.2,
          color: style.color,
          whiteSpace: "pre-wrap",
          overflowWrap: "anywhere",
          textAlign: style.align,
          padding: `${8 * scale}px ${18 * scale}px`,
          background: `${style.background}${Math.round(
            style.backgroundOpacity * 255,
          )
            .toString(16)
            .padStart(2, "0")}`,
          borderRadius: 12 * scale,
        }}
      >
        {text}
      </div>
    </div>
  );
}
