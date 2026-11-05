import { MAX_SCENES } from "./timeline-limits";
import {
  keyframeMotion,
  timelineSchema,
  type Layer,
  type Scene,
  type Timeline,
} from "./schema";
type Keys = NonNullable<Layer["keyframes"]>;
export function sliceKeys(
  keys: Keys | undefined,
  start: number,
  end: number,
): Keys | undefined {
  if (!keys?.length) return keys;
  const result = keys
    .filter((k) => k.frame >= start && k.frame < end)
    .map((k) => ({ ...k, frame: k.frame - start }));
  for (const frame of [start, end - 1]) {
    if (
      frame > keys[0].frame &&
      frame < keys.at(-1)!.frame &&
      !result.some((k) => k.frame === frame - start)
    ) {
      const pose = keyframeMotion(keys, frame);
      result.push({
        frame: frame - start,
        x: pose.x,
        y: pose.y,
        scale: pose.scale,
        opacity: pose.opacity,
      });
    }
  }
  // A slice wholly before/after the keys keeps their held pose.
  if (!result.length) {
    const p = keyframeMotion(keys, start);
    result.push({
      frame: 0,
      x: p.x,
      y: p.y,
      scale: p.scale,
      opacity: p.opacity,
    });
  }
  return result.sort((a, b) => a.frame - b.frame);
}
function sceneSlice(scene: Scene, start: number, end: number): Scene {
  return {
    ...scene,
    durationFrames: end - start,
    motionOffsetFrames: (scene.motionOffsetFrames || 0) + start,
    camera: sliceKeys(scene.camera, start, end),
    layers: scene.layers.flatMap((layer) => {
      const keyframes = sliceKeys(layer.keyframes, start, end);
      if (layer.kind !== "video" || !layer.video)
        return [{ ...layer, keyframes }];
      const v = layer.video,
        begin = Math.max(start, v.startFrame),
        finish = Math.min(end, v.startFrame + v.durationFrames);
      if (finish <= begin) return [];
      return [
        {
          ...layer,
          keyframes,
          video: {
            ...v,
            startFrame: begin - start,
            offsetFrames: v.offsetFrames + begin - v.startFrame,
            durationFrames: finish - begin,
          },
        },
      ];
    }),
  };
}
export function splitScene(
  t: Timeline,
  index: number,
  frame: number,
): Timeline {
  const s = t.scenes[index];
  if (
    !s ||
    !Number.isInteger(frame) ||
    frame < 30 ||
    frame > s.durationFrames - 30
  )
    throw new Error("Each split scene needs at least one second.");
  if (t.scenes.length >= MAX_SCENES)
    throw new Error(`The limit is ${MAX_SCENES} scenes.`);
  const left = { ...sceneSlice(s, 0, frame), fadeOut: false };
  const right = {
    ...sceneSlice(s, frame, s.durationFrames),
    id: crypto.randomUUID(),
    title: `${s.title.slice(0, 90)} (split)`,
    fadeIn: false,
  };
  return timelineSchema.parse({
    ...t,
    scenes: [
      ...t.scenes.slice(0, index),
      left,
      right,
      ...t.scenes.slice(index + 1),
    ],
  });
}
