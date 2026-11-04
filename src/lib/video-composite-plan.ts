import type { Timeline, Layer } from "./schema";
import { staticScenePlan, type StaticScenePlan } from "./static-scene";

export type VideoCompositePlan = StaticScenePlan & { video: Layer };
export type VideoCompositePass = {
  videoLayerId: string;
  part: "under" | "over";
};

// One untransformed moving clip with otherwise still artwork. All continuous
// SVG motion, fades, cameras, multiple clips and unknown kinds keep the existing
// full-frame renderer. Caption changes retain their exact frame boundaries.
export function videoCompositePlan(
  timeline: Timeline,
): VideoCompositePlan | null {
  if (timeline.scenes.length !== 1) return null;
  const scene = timeline.scenes[0];
  const videos = scene.layers.filter(
    (layer) => layer.kind === "video" && !layer.hidden,
  );
  if (videos.length !== 1) return null;
  const video = videos[0];
  if (
    !video.assetId ||
    !video.video ||
    video.rotation ||
    video.animation !== "none" ||
    video.keyframes?.length ||
    video.x + video.width > 1 ||
    video.y + video.height > 1
  )
    return null;
  const still = staticScenePlan(
    {
      ...timeline,
      scenes: [
        {
          ...scene,
          layers: scene.layers.filter((layer) => layer.id !== video.id),
        },
      ],
    },
    32,
  );
  return still ? { ...still, video } : null;
}
