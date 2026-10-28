import type { CSSProperties } from "react";
import type { Layer } from "./schema";
export function textStyle(layer: Layer, width: number): CSSProperties {
  return {
    fontSize: (layer.fontSize * width) / 1280,
    fontWeight: layer.fontSize > 30 ? 700 : 500,
    lineHeight: 1.12,
    whiteSpace: "pre-wrap",
    overflowWrap: "anywhere",
    flexShrink: 0,
    width: "100%",
  };
}
