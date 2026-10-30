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
  kind: z.enum([
    "text",
    "circle",
    "rectangle",
    "mountain",
    "nodes",
    "image",
    "video",
    "character",
    "arrow",
    "gradient",
  ]),
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  width: z.number().min(0.01).max(1),
  height: z.number().min(0.01).max(1),
  text: z.string().max(140).default(""),
  color: color,
  fontSize: z.number().min(12).max(120).default(48),
  fontFamily: z.enum(["sans", "serif", "mono"]).optional(),
  fontWeight: z
    .enum(["regular", "medium", "semibold", "bold", "heavy"])
    .optional(),
  textAlign: z.enum(["left", "center", "right"]).optional(),
  lineHeight: z.number().min(1).max(2).optional(),
  letterSpacing: z.number().min(-2).max(8).optional(),
  italic: z.boolean().optional(),
  underline: z.boolean().optional(),
  imageFit: z.enum(["contain", "cover"]).optional(),
  mediaPosition: z
    .object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) })
    .optional(),
  animation: z.enum(["rise", "drift", "pulse", "none"]).default("rise"),
  hidden: z.boolean().optional(),
  locked: z.boolean().optional(),
  assetId: z.string().optional(),
  keyframes: z.array(keyframeSchema).max(30).optional(),
  video: z
    .object({
      startFrame: z.number().int().min(0).max(599),
      offsetFrames: z.number().int().min(0).max(3599),
      durationFrames: z.number().int().min(1).max(600),
      volume: z.number().min(0).max(1).default(1),
      audio: z.boolean().default(false),
      fit: z.enum(["contain", "cover"]).default("contain"),
    })
    .optional(),
});
export const sceneSchema = z.object({
  id: z.string().min(1).max(80),
  title: z.string().min(1).max(100),
  intent: z.string().max(500),
  durationFrames: z.number().int().min(30).max(600),
  background: color,
  accent: color,
  strategy: z.enum(["typography", "diagram", "landscape"]),
  layers: z.array(layerSchema).max(20),
  transition: z.enum(["fade", "cut"]).default("fade"),
  camera: z.array(keyframeSchema).max(30).optional(),
  motionOffsetFrames: z.number().int().min(0).max(1799).optional(),
  fadeIn: z.boolean().optional(),
  fadeOut: z.boolean().optional(),
});
export const audioTrackSchema = z.object({
  id: z.string().min(1).max(80),
  assetId: z.string().uuid(),
  startFrame: z.number().int().min(0).max(1799),
  offsetFrames: z.number().int().min(0).max(3599).default(0),
  durationFrames: z.number().int().min(1).max(1800),
  volume: z.number().min(0).max(1).default(0.8),
  fadeFrames: z.number().int().min(0).max(150).default(6),
});
export const captionSchema = z.object({
  id: z.string().min(1).max(80),
  startFrame: z.number().int().min(0),
  endFrame: z.number().int().max(1800),
  text: z
    .string()
    .trim()
    .min(1)
    .max(80)
    .transform((s) => s.replace(/\s+/g, " ")),
});
export const captionStyleSchema = z.object({
  fontFamily: z.enum(["sans", "serif", "mono"]).default("sans"),
  fontSize: z.number().int().min(18).max(56).default(28),
  bold: z.boolean().default(false),
  color: color.default("#ffffff"),
  background: color.default("#000000"),
  backgroundOpacity: z.number().min(0).max(1).default(0.87),
  position: z.enum(["top", "middle", "bottom"]).default("bottom"),
  align: z.enum(["left", "center", "right"]).default("center"),
  margin: z.number().min(3).max(12).default(3),
});
export const timelineSchema = z
  .object({
    fps: z.literal(30),
    format: z.enum(["landscape", "portrait", "square"]),
    scenes: z.array(sceneSchema).min(1).max(12),
    audioTracks: z.array(audioTrackSchema).max(4).optional(),
    captions: z.array(captionSchema).max(100).optional(),
    captionStyle: captionStyleSchema.optional(),
  })
  .superRefine((t, ctx) => {
    const frames = t.scenes.reduce((n, s) => n + s.durationFrames, 0);
    const tracks = t.audioTracks || [],
      captions = [...(t.captions || [])].sort(
        (a, b) => a.startFrame - b.startFrame,
      );
    if (
      tracks.length +
        t.scenes.flatMap((s) =>
          s.layers.filter(
            (l) =>
              l.kind === "video" &&
              !l.hidden &&
              l.video?.audio &&
              l.video.volume > 0,
          ),
        ).length >
      32
    )
      ctx.addIssue({
        code: "custom",
        message: "Use at most 32 audible clips/tracks.",
      });
    if (
      new Set(tracks.map((a) => a.id)).size !== tracks.length ||
      new Set(captions.map((c) => c.id)).size !== captions.length
    )
      ctx.addIssue({
        code: "custom",
        message: "Audio track and caption IDs must be unique.",
      });
    if (
      tracks.some(
        (a) =>
          a.startFrame + a.durationFrames > frames ||
          a.fadeFrames * 2 > a.durationFrames,
      )
    )
      ctx.addIssue({
        code: "custom",
        message: "Audio tracks and fades must fit the timeline.",
      });
    if (
      captions.some(
        (c, i) =>
          c.endFrame <= c.startFrame ||
          c.endFrame > frames ||
          (i > 0 && c.startFrame < captions[i - 1].endFrame),
      )
    )
      ctx.addIssue({
        code: "custom",
        message:
          "Captions must have positive duration, fit the timeline, and not overlap.",
      });
    if (t.scenes.reduce((n, s) => n + s.durationFrames, 0) > 1800)
      ctx.addIssue({
        code: "custom",
        message: "Video must be 60 seconds or less.",
      });
    if (new Set(t.scenes.map((s) => s.id)).size !== t.scenes.length)
      ctx.addIssue({ code: "custom", message: "Scene IDs must be unique." });
    for (const scene of t.scenes)
      if ((scene.motionOffsetFrames || 0) + scene.durationFrames > 1800)
        ctx.addIssue({
          code: "custom",
          message: "Scene motion phase must fit within 60 seconds.",
        });
    for (const scene of t.scenes)
      if (
        (scene.camera || []).some(
          (k, i, keys) =>
            k.frame >= scene.durationFrames ||
            (i > 0 && k.frame <= keys[i - 1].frame),
        )
      )
        ctx.addIssue({
          code: "custom",
          message: "Camera keyframes must increase and fit their scene.",
        });
    for (const scene of t.scenes)
      for (const layer of scene.layers)
        if (
          layer.kind === "video" &&
          (!layer.assetId ||
            !layer.video ||
            layer.video.startFrame + layer.video.durationFrames >
              scene.durationFrames)
        )
          ctx.addIssue({
            code: "custom",
            message:
              "Video layers require an asset and a clip range that fits their scene.",
          });
    for (const scene of t.scenes)
      for (const layer of scene.layers)
        if (layer.kind === "image" && !layer.assetId)
          ctx.addIssue({
            code: "custom",
            message: "Image layers require an uploaded asset.",
          });
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
  name: string;
  source: string;
  license: string;
  mime: "image/png" | "audio/wav" | "video/mp4";
  bytes?: number;
  durationFrames?: number;
  width?: number;
  height?: number;
  hasAudio?: boolean;
  createdAt: string;
};
export type AudioTrack = z.infer<typeof audioTrackSchema>;
export type Caption = z.infer<typeof captionSchema>;
export type QCIssue = {
  sceneId: string;
  layerId?: string;
  code:
    | "bounds"
    | "overlap"
    | "readability"
    | "missing-asset"
    | "text-overflow"
    | "contrast"
    | "audio-level";
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
  assets?: Asset[];
  timeline: Timeline | null;
  revisions: Revision[];
  messages: { role: "user" | "assistant"; content: string }[];
  createdAt: string;
  trashedAt?: string;
};
export type ProjectSummary = {
  id: string;
  name: string;
  createdAt: string;
  revisionCount: number;
  trashedAt?: string;
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
  retryCount?: number;
  stage?: string;
  events?: { at: string; stage: string; message: string }[];
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
  return keyframeMotion(keys, frame);
}
export function keyframeMotion(
  keys: NonNullable<Layer["keyframes"]>,
  frame: number,
) {
  if (!keys.length) return { x: 0, y: 0, scale: 1, opacity: 1, translateY: 0 };
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
