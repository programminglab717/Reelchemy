import {
  captionStyleSchema,
  formats,
  type Timeline,
  type QCIssue,
} from "./schema";
export function contrastRatio(a: string, b: string) {
  const luminance = (hex: string) => {
    const channels = [1, 3, 5]
      .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
      .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
  };
  const x = luminance(a),
    y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
export function inspectTimeline(
  t: Timeline,
  assetIds: string[] = [],
): QCIssue[] {
  const issues: QCIssue[] = [];
  if (t.captions?.length) {
    const style = t.captionStyle || captionStyleSchema.parse({});
    if (
      style.backgroundOpacity < 0.8 ||
      contrastRatio(style.color, style.background) < 4.5
    )
      issues.push({
        sceneId: "captions",
        code: "contrast",
        severity: "warning",
        message:
          "Caption contrast depends on the artwork or is low against its background. Inspect the caption area in the rendered video.",
      });
  }
  for (const caption of t.captions || [])
    if (
      caption.text.length / ((caption.endFrame - caption.startFrame) / 30) >
      25
    )
      issues.push({
        sceneId: "captions",
        layerId: caption.id,
        code: "readability",
        severity: "warning",
        message: `Caption ${caption.id} may be too brief to read.`,
      });
  for (const s of t.scenes) {
    for (const l of s.layers) {
      if (l.hidden) continue;
      if (
        l.kind === "text" &&
        contrastRatio(l.color, s.background) <
          ((l.fontSize * formats[t.format].width) / 1280 >= 24 ? 3 : 4.5)
      )
        issues.push({
          sceneId: s.id,
          layerId: l.id,
          code: "contrast",
          severity: "warning",
          message: `Text ${l.id} has low contrast against the declared scene background; inspect the rendered frame.`,
        });
      if (
        (l.keyframes || []).some((k) => {
          const x = l.x + k.x - (l.width * (k.scale - 1)) / 2,
            y = l.y + k.y - (l.height * (k.scale - 1)) / 2;
          return (
            x < 0 ||
            y < 0 ||
            x + l.width * k.scale > 1 ||
            y + l.height * k.scale > 1
          );
        })
      )
        issues.push({
          sceneId: s.id,
          layerId: l.id,
          code: "bounds",
          severity: "error",
          message: `Motion keyframes move ${l.id} outside the frame.`,
        });
      if (l.x + l.width > 1 || l.y + l.height > 1)
        issues.push({
          sceneId: s.id,
          layerId: l.id,
          code: "bounds",
          message: `${l.id} extends outside the frame.`,
          severity: "error",
        });
      if (l.assetId && !assetIds.includes(l.assetId))
        issues.push({
          sceneId: s.id,
          layerId: l.id,
          code: "missing-asset",
          message: `Missing asset: ${l.assetId}`,
          severity: "error",
        });
      if (l.kind === "text" && l.text.length > 90)
        issues.push({
          sceneId: s.id,
          layerId: l.id,
          code: "readability",
          message: "Long text may be difficult to read. Preview before export.",
          severity: "warning",
        });
    }
    const text = s.layers.filter((l) => l.kind === "text" && !l.hidden);
    for (let i = 0; i < text.length; i++)
      for (let j = i + 1; j < text.length; j++) {
        const a = text[i],
          b = text[j];
        if (
          a.x < b.x + b.width &&
          a.x + a.width > b.x &&
          a.y < b.y + b.height &&
          a.y + a.height > b.y
        )
          issues.push({
            sceneId: s.id,
            layerId: b.id,
            code: "overlap",
            message: `Text layers ${a.id} and ${b.id} overlap.`,
            severity: "error",
          });
      }
  }
  return issues;
}
export function repairBounds(
  t: Timeline,
  maxAttempts = 1,
  assetIds: string[] = [],
) {
  const timeline = structuredClone(t);
  let attempts = 0;
  const before = inspectTimeline(timeline, assetIds);
  while (
    attempts < Math.min(2, Math.max(0, maxAttempts)) &&
    inspectTimeline(timeline, assetIds).some((i) => i.code === "bounds")
  ) {
    for (const s of timeline.scenes)
      for (const l of s.layers) {
        if (l.hidden) continue;
        l.x = Math.min(l.x, 1 - l.width);
        l.y = Math.min(l.y, 1 - l.height);
      }
    attempts++;
  }
  return {
    timeline,
    attempts,
    before,
    after: inspectTimeline(timeline, assetIds),
  };
}
