import type { AudioTrack } from "./schema";
export function audioGain(track: AudioTrack, frame: number) {
  if (frame < 0 || frame >= track.durationFrames) return 0;
  const fade = track.fadeFrames;
  return (
    track.volume *
    (fade
      ? Math.min(1, frame / fade, (track.durationFrames - frame) / fade)
      : 1)
  );
}
