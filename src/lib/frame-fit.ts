import { videoDimensions, type Layer, type Timeline } from "./schema";

// Keeps model-planned layered scenes inside the video frame: every layer's box
// and every keyframe position stays within the frame, and text is shrunk to an
// estimated fit in its box. Export still measures real text in Chromium (layout
// QC); this makes the saved plan and the live preview fit from the start.
export function fitLayersToFrame(timeline: Timeline): Timeline {
  const { width, height } = videoDimensions(timeline);
  return {
    ...timeline,
    scenes: timeline.scenes.map((scene) =>
      scene.code
        ? scene
        : {
            ...scene,
            layers: scene.layers.map((layer) => fitLayer(layer, width, height)),
          },
    ),
  };
}

const clamp = (value: number, low: number, high: number) =>
  Math.min(high, Math.max(low, value));
// Keeps rounding from putting an edge a hair past the frame.
const EDGE = 1e-6;

function fitLayer(layer: Layer, frameWidth: number, frameHeight: number) {
  const width = Math.min(1, layer.width),
    height = Math.min(1, layer.height);
  const x = clamp(layer.x, 0, 1 - width - EDGE),
    y = clamp(layer.y, 0, 1 - height - EDGE);
  const keyframes = layer.keyframes?.map((key) => {
    // A keyframe scales about the layer's centre and offsets it by (x, y).
    const scale = clamp(key.scale, 0.1, Math.min(3, 1 / width, 1 / height));
    const grownX = (width * (scale - 1)) / 2,
      grownY = (height * (scale - 1)) / 2;
    const left = clamp(x + key.x - grownX, EDGE, 1 - width * scale - EDGE),
      top = clamp(y + key.y - grownY, EDGE, 1 - height * scale - EDGE);
    return {
      ...key,
      scale,
      x: clamp(left - x + grownX, -1, 1),
      y: clamp(top - y + grownY, -1, 1),
    };
  });
  const fitted: Layer = {
    ...layer,
    x,
    y,
    width,
    height,
    ...(keyframes ? { keyframes } : {}),
  };
  if (layer.kind === "text" && layer.text.trim())
    fitted.fontSize = fittingFontSize(
      fitted,
      width * frameWidth,
      height * frameHeight,
      frameWidth,
    );
  return fitted;
}

// The largest font size, up to the layer's own, at which the text is
// estimated to fit its box (greedy word wrap with an average glyph width).
export function fittingFontSize(
  layer: Layer,
  boxWidth: number,
  boxHeight: number,
  frameWidth: number,
) {
  const glyph = layer.fontFamily === "mono" ? 0.62 : 0.58;
  const lineHeight = layer.lineHeight || 1.12;
  let size = layer.fontSize;
  for (; size > 12; size -= 1) {
    const px = (size * frameWidth) / 1280;
    const advance =
      px * glyph + ((layer.letterSpacing || 0) * frameWidth) / 1280;
    const perLine = Math.max(1, Math.floor(boxWidth / advance));
    let lines = 0,
      widest = 0;
    for (const paragraph of layer.text.split("\n")) {
      let line = 0;
      lines++;
      for (const word of paragraph.split(/\s+/).filter(Boolean)) {
        widest = Math.max(widest, Math.min(word.length, perLine));
        // Words longer than a line break anywhere (overflowWrap: anywhere).
        if (word.length > perLine) {
          const pieces = Math.ceil(word.length / perLine);
          lines += pieces - (line ? 0 : 1);
          line = word.length % perLine || perLine;
          continue;
        }
        if (line && line + 1 + word.length > perLine) {
          lines++;
          line = word.length;
        } else line += (line ? 1 : 0) + word.length;
      }
    }
    if (lines * lineHeight * px <= boxHeight && widest <= perLine) break;
  }
  return Math.max(12, size);
}
