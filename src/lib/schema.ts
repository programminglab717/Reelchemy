import { z } from "zod";
export const FPS = 30;
export const formats = {
  landscape: { width: 1280, height: 720 },
  portrait: { width: 720, height: 1280 },
  square: { width: 1080, height: 1080 },
} as const;
const color = z.string().regex(/^#[0-9a-fA-F]{6}$/);
export const keyframeSchema = z.object({
  frame: z.number().int().min(0).max(599),
  x: z.number().min(-1).max(1),
  y: z.number().min(-1).max(1),
  scale: z.number().min(0.1).max(3),
  opacity: z.number().min(0).max(1),
});
export const layerSchema = z.object({
  id: z.string().min(1).max(80),
  kind: z.enum(["text", "circle", "rectangle", "mountain", "nodes"]),
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  width: z.number().min(0.01).max(1),
  height: z.number().min(0.01).max(1),
  text: z.string().max(140).default(""),
  color: color,
  fontSize: z.number().min(12).max(120).default(48),
  animation: z.enum(["rise", "drift", "pulse", "none"]).default("rise"),
  assetId: z.string().optional(),
  keyframes: z.array(keyframeSchema).max(30).optional(),
});
export const sceneSchema = z.object({
  id: z.string().min(1).max(80),
  title: z.string().min(1).max(100),
  intent: z.string().max(500),
  durationFrames: z.number().int().min(30).max(600),
  background: color,
  accent: color,
  strategy: z.enum(["typography", "diagram", "landscape"]),
  layers: z.array(layerSchema).min(1).max(20),
  transition: z.enum(["fade", "cut"]).default("fade"),
});
export const timelineSchema = z
  .object({
    fps: z.literal(30),
    format: z.enum(["landscape", "portrait", "square"]),
    scenes: z.array(sceneSchema).min(1).max(12),
  })
  .superRefine((t, ctx) => {
    if (t.scenes.reduce((n, s) => n + s.durationFrames, 0) > 1800)
      ctx.addIssue({
        code: "custom",
        message: "Video must be 60 seconds or less.",
      });
    if (new Set(t.scenes.map((s) => s.id)).size !== t.scenes.length)
      ctx.addIssue({ code: "custom", message: "Scene IDs must be unique." });
    for (const scene of t.scenes)
      for (const layer of scene.layers) {
        const keys = layer.keyframes || [];
        if (
          keys.some(
            (k, i) =>
              k.frame >= scene.durationFrames ||
              (i > 0 && k.frame <= keys[i - 1].frame),
          )
        )
          ctx.addIssue({
            code: "custom",
            message:
              "Keyframes must increase strictly and fit inside their scene.",
          });
      }
    for (const s of t.scenes)
      if (new Set(s.layers.map((l) => l.id)).size !== s.layers.length)
        ctx.addIssue({
          code: "custom",
          message: `Layer IDs in ${s.id} must be unique.`,
        });
  });
export type Layer = z.infer<typeof layerSchema>;
export type Scene = z.infer<typeof sceneSchema>;
export type Timeline = z.infer<typeof timelineSchema>;
export type CreativeBrief = {
  prompt: string;
  duration: number;
  format: Timeline["format"];
};
export type Asset = {
  id: string;
  path: string;
  source: string;
  license: string;
};
export type AudioTrack = {
  id: string;
  assetId: string;
  startFrame: number;
  durationFrames: number;
};
export type QCIssue = {
  sceneId: string;
  layerId?: string;
  code:
    | "bounds"
    | "overlap"
    | "readability"
    | "missing-asset"
    | "text-overflow"
    | "contrast";
  message: string;
  severity: "error" | "warning";
};
export type Revision = {
  id: string;
  createdAt: string;
  timeline: Timeline;
  source: string;
};
export type Project = {
  id: string;
  name: string;
  brief: CreativeBrief;
  timeline: Timeline | null;
  revisions: Revision[];
  messages: { role: "user" | "assistant"; content: string }[];
  createdAt: string;
};
export type ProviderConfig = {
  provider: "mock" | "compatible";
  model?: string;
  baseUrl?: string;
};
export type Export = {
  path: string;
  codec: string;
  width: number;
  height: number;
  fps: number;
  duration: number;
};
export type RenderJob = {
  id: string;
  projectId: string;
  status: "queued" | "rendering" | "completed" | "failed" | "cancelled";
  progress: number;
  error: string | null;
  createdAt: string;
  issues: QCIssue[];
  report: Record<string, unknown> | null;
  attempts: number;
};
export const totalFrames = (t: Timeline) =>
  t.scenes.reduce((n, s) => n + s.durationFrames, 0);
export function sceneAt(t: Timeline, frame: number) {
  let start = 0;
  for (const scene of t.scenes) {
    if (frame >= start && frame < start + scene.durationFrames)
      return { scene, localFrame: frame - start };
    start += scene.durationFrames;
  }
  return null;
}
export function animationState(frame: number, animation: Layer["animation"]) {
  const entry = Math.min(1, Math.max(0, frame / 20));
  return {
    opacity: animation === "none" ? 1 : entry,
    translateY:
      animation === "rise"
        ? (1 - entry) * 24
        : animation === "drift"
          ? Math.sin(frame / 45) * 8
          : 0,
    scale: animation === "pulse" ? 1 + Math.sin(frame / 20) * 0.025 : 1,
  };
}

export function layerMotion(layer: Layer, frame: number) {
  const fallback = animationState(frame, layer.animation),
    keys = layer.keyframes || [];
  if (!keys.length) return { ...fallback, x: 0, y: 0 };
  const right = keys.findIndex((k) => k.frame >= frame);
  const a = right < 0 ? keys[keys.length - 1] : keys[Math.max(0, right - 1)],
    b = right < 0 ? a : keys[right];
  const fraction =
    a.frame === b.frame
      ? 0
      : Math.max(0, Math.min(1, (frame - a.frame) / (b.frame - a.frame)));
  const value = (key: "x" | "y" | "scale" | "opacity") =>
    a[key] + (b[key] - a[key]) * fraction;
  return {
    x: value("x"),
    y: value("y"),
    scale: value("scale"),
    opacity: value("opacity"),
    translateY: 0,
  };
}
