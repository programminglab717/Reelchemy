import type { Layer } from "./schema";
export type CanvasSize = { width: number; height: number };
export type Point = { x: number; y: number };

// Coordinates are normalized, but rotation happens in composition pixels.
// Rotating directly in normalized space distorts angles on portrait/landscape.
export function layerCorners(layer: Layer, size: CanvasSize): Point[] {
  const angle = ((layer.rotation || 0) * Math.PI) / 180;
  const cos = Math.cos(angle),
    sin = Math.sin(angle);
  const cx = (layer.x + layer.width / 2) * size.width;
  const cy = (layer.y + layer.height / 2) * size.height;
  return [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ].map(([x, y]) => {
    const dx = (x * layer.width * size.width) / 2,
      dy = (y * layer.height * size.height) / 2;
    return {
      x: (cx + dx * cos - dy * sin) / size.width,
      y: (cy + dx * sin + dy * cos) / size.height,
    };
  });
}
export function polygonsOverlap(a: Point[], b: Point[]) {
  for (const polygon of [a, b])
    for (let i = 0; i < polygon.length; i++) {
      const edge = polygon[(i + 1) % polygon.length];
      const axis = { x: -(edge.y - polygon[i].y), y: edge.x - polygon[i].x };
      const project = (p: Point) => p.x * axis.x + p.y * axis.y;
      const first = a.map(project),
        second = b.map(project);
      if (
        Math.max(...first) <= Math.min(...second) + 1e-12 ||
        Math.max(...second) <= Math.min(...first) + 1e-12
      )
        return false;
    }
  return true;
}
const round = (n: number) => Math.round(n * 10000) / 10000;
const clamp = (n: number, min: number, max: number) =>
  Math.max(min, Math.min(max, n));
export function resizeRotatedLayer(
  layer: Layer,
  dx: number,
  dy: number,
  size: CanvasSize,
): Layer {
  if (layer.locked) return layer;
  const angle = ((layer.rotation || 0) * Math.PI) / 180,
    cos = Math.cos(angle),
    sin = Math.sin(angle);
  const anchor = layerCorners(layer, size)[0];
  const width = clamp(
    layer.width + dx * cos + ((dy * size.height) / size.width) * sin,
    0.01,
    1,
  );
  const height = clamp(
    layer.height - ((dx * size.width) / size.height) * sin + dy * cos,
    0.01,
    1,
  );
  function at(amount: number): Layer {
    const w = layer.width + (width - layer.width) * amount;
    const h = layer.height + (height - layer.height) * amount;
    return {
      ...layer,
      width: w,
      height: h,
      x: anchor.x + (w * cos - ((h * size.height) / size.width) * sin - w) / 2,
      y: anchor.y + (((w * size.width) / size.height) * sin + h * cos - h) / 2,
    };
  }
  const valid = (l: Layer) =>
    l.x >= -1e-10 &&
    l.y >= -1e-10 &&
    l.x + l.width <= 1 + 1e-10 &&
    l.y + l.height <= 1 + 1e-10;
  let candidate = at(1);
  if (!valid(candidate)) {
    if (!valid(layer)) return layer;
    let low = 0,
      high = 1;
    for (let i = 0; i < 32; i++) {
      const mid = (low + high) / 2;
      if (valid(at(mid))) low = mid;
      else high = mid;
    }
    candidate = at(low);
  }
  const x = round(clamp(candidate.x, 0, 0.99)),
    y = round(clamp(candidate.y, 0, 0.99));
  return {
    ...layer,
    x,
    y,
    width: Math.min(round(candidate.width), round(1 - x)),
    height: Math.min(round(candidate.height), round(1 - y)),
  };
}
