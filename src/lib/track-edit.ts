export type TrackRange = {
  startFrame: number;
  offsetFrames: number;
  durationFrames: number;
};
export type TrackBounds = {
  minFrame: number;
  maxFrame: number;
  sourceFrames?: number;
};
export type TrackAction = "move" | "start" | "end";
const clamp = (n: number, min: number, max: number) =>
  Math.min(max, Math.max(min, n));
export function editTrack(
  range: TrackRange,
  delta: number,
  action: TrackAction,
  bounds: TrackBounds,
): TrackRange {
  delta = Math.round(delta);
  const {
    startFrame: start,
    offsetFrames: offset,
    durationFrames: length,
  } = range;
  if (action === "move")
    return {
      ...range,
      startFrame: clamp(
        start + delta,
        bounds.minFrame,
        bounds.maxFrame - length,
      ),
    };
  if (action === "start") {
    const next = clamp(
      start + delta,
      Math.max(
        bounds.minFrame,
        bounds.sourceFrames === undefined ? bounds.minFrame : start - offset,
      ),
      start + length - 1,
    );
    return {
      startFrame: next,
      offsetFrames:
        bounds.sourceFrames === undefined ? 0 : offset + next - start,
      durationFrames: start + length - next,
    };
  }
  const end = clamp(
    start + length + delta,
    start + 1,
    Math.min(
      bounds.maxFrame,
      bounds.sourceFrames === undefined
        ? bounds.maxFrame
        : start + bounds.sourceFrames - offset,
    ),
  );
  return { ...range, durationFrames: end - start };
}
