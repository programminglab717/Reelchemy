import type { Layer } from "./schema";
const clamp = (v: number, min: number, max: number) =>
  Math.min(max, Math.max(min, v));
const round = (v: number) => Math.round(v * 10000) / 10000;
export function placeLayer(
  layer: Layer,
  dx: number,
  dy: number,
  resize = false,
  snap = true,
): Layer {
  if (layer.locked) return layer;
  if (resize)
    return {
      ...layer,
      width: round(clamp(layer.width + dx, 0.01, 1 - layer.x)),
      height: round(clamp(layer.height + dy, 0.01, 1 - layer.y)),
    };
  const align = (v: number, size: number) => {
    const candidate = snap
      ? [0, (1 - size) / 2, 1 - size].find((n) => Math.abs(n - v) < 0.012)
      : undefined;
    return round(clamp(candidate ?? v, 0, Math.max(0, 1 - size)));
  };
  return {
    ...layer,
    x: align(layer.x + dx, layer.width),
    y: align(layer.y + dy, layer.height),
  };
}
