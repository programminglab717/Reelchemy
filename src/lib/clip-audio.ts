import type { Timeline, AudioTrack } from "./schema";
export function clipAudioTracks(t: Timeline): AudioTrack[] {
  return t.scenes.flatMap((s, i) => {
    const start = t.scenes
      .slice(0, i)
      .reduce((n, p) => n + p.durationFrames, 0);
    return s.layers
      .filter(
        (l) =>
          l.kind === "video" &&
          !l.hidden &&
          l.video?.audio &&
          l.video.volume > 0,
      )
      .map((l) => ({
        id: `${s.id}:${l.id}`,
        assetId: l.assetId!,
        startFrame: start + l.video!.startFrame,
        offsetFrames: l.video!.offsetFrames,
        durationFrames: l.video!.durationFrames,
        volume: l.video!.volume,
        fadeFrames: 0,
      }));
  });
}
