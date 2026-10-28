import { type Timeline, type QCIssue } from "./schema";
export function inspectTimeline(
  t: Timeline,
  assetIds: string[] = [],
): QCIssue[] {
  const issues: QCIssue[] = [];
  for (const s of t.scenes) {
    for (const l of s.layers) {
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
    const text = s.layers.filter((l) => l.kind === "text");
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
