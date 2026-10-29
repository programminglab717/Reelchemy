import type { CSSProperties } from "react";
import type { Layer } from "./schema";
export function mediaStyle(layer: Layer): CSSProperties {
  return {
    width: "100%",
    height: "100%",
    objectFit:
      layer.kind === "video"
        ? layer.video?.fit || "contain"
        : layer.imageFit || "contain",
    objectPosition: `${(layer.mediaPosition?.x ?? 0.5) * 100}% ${(layer.mediaPosition?.y ?? 0.5) * 100}%`,
  };
}
