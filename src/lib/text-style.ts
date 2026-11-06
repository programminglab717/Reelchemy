import type { CSSProperties } from "react";
import type { Layer } from "./schema";
export const fontFamilies = {
  sans: "Arial, sans-serif",
  serif: "Georgia, serif",
  mono: "'Courier New', monospace",
};
export const fontWeights = {
  regular: 400,
  medium: 500,
  semibold: 600,
  bold: 700,
  heavy: 800,
};
// CSS family name for an uploaded font. Asset IDs are validated UUIDs, so the
// name needs no escaping; the layer's generic family remains the fallback.
export function fontFaceFamily(assetId: string) {
  return `reelchemy-font-${assetId}`;
}
export function layerFontFamily(layer: Layer) {
  const fallback = fontFamilies[layer.fontFamily || "sans"];
  return layer.fontAssetId
    ? `"${fontFaceFamily(layer.fontAssetId)}", ${fallback}`
    : fallback;
}
export function textStyle(layer: Layer, width: number): CSSProperties {
  return {
    fontSize: (layer.fontSize * width) / 1280,
    fontFamily: layerFontFamily(layer),
    fontWeight: layer.fontWeight
      ? fontWeights[layer.fontWeight]
      : layer.fontSize > 30
        ? 700
        : 500,
    textAlign: layer.textAlign || "left",
    fontStyle: layer.italic ? "italic" : "normal",
    textDecoration: layer.underline ? "underline" : "none",
    letterSpacing: ((layer.letterSpacing || 0) * width) / 1280,
    lineHeight: layer.lineHeight || 1.12,
    whiteSpace: "pre-wrap",
    overflowWrap: "anywhere",
    flexShrink: 0,
    width: "100%",
  };
}
