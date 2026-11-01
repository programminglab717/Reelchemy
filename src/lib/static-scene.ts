import { captionAt } from "./captions";
import type { Timeline } from "./schema";

// Keep this allowlist explicit: some primitives have their own continuous SVG
// motion even when their layer animation is "none". Unknown future kinds must
// use ordinary frame rendering until their visual behavior is reviewed.
const stillKinds = new Set([
  "text",
  "rectangle",
  "mountain",
  "image",
  "arrow",
  "gradient",
]);
export type StaticScenePlan = {
  capturedFrames: number[];
  sourceFrames: number[];
};
export function staticScenePlan(timeline: Timeline): StaticScenePlan | null {
  if (timeline.scenes.length !== 1) return null;
  const scene = timeline.scenes[0];
  if (
    scene.camera?.length ||
    (scene.transition !== "cut" &&
      (scene.fadeIn !== false || scene.fadeOut !== false)) ||
    scene.layers.some(
      (layer) =>
        !layer.hidden &&
        (!stillKinds.has(layer.kind) ||
          layer.animation !== "none" ||
          !!layer.keyframes?.length),
    )
  )
    return null;
  const capturedFrames: number[] = [];
  const sourceFrames: number[] = [];
  let previous: string | undefined;
  let representative = 0;
  for (let frame = 0; frame < scene.durationFrames; frame++) {
    const caption = captionAt(timeline, frame);
    const state = JSON.stringify(caption ? [caption.id, caption.text] : null);
    if (frame === 0 || state !== previous) {
      representative = frame;
      capturedFrames.push(frame);
      // Each still has its own bounded browser capture. Avoid turning caption
      // heavy scenes into hundreds of still operations or full-frame disk IO.
      if (capturedFrames.length > 8) return null;
    }
    sourceFrames.push(representative);
    previous = state;
  }
  if (sourceFrames.length - capturedFrames.length < 90) return null;
  return { capturedFrames, sourceFrames };
}
