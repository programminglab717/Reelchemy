export const MAX_TIMELINE_SECONDS = 300;
export const MAX_TIMELINE_FRAMES = MAX_TIMELINE_SECONDS * 30;
export const MAX_SCENES = 60;
export const MAX_AUDIO_TRACKS = 12;
export const MAX_CAPTIONS = 500;
// Keep current/history reads and compact downloaded recovery documents within
// the existing 2 MiB bound, including their small account/CAS envelope.
export const MAX_EDITABLE_TIMELINE_BYTES = 2 * 1024 ** 2 - 4096;
export const DURATION_PRESETS = [5, 15, 30, 60, 180, 300] as const;

// Fixed legacy capabilities: do not replace these thresholds with current limits.
// Older readers would reject or silently truncate work exceeding these values.
export function usesExtendedTimeline(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const timeline = value as Record<string, unknown>;
  const scenes = Array.isArray(timeline.scenes) ? timeline.scenes : [];
  const tracks = Array.isArray(timeline.audioTracks)
    ? timeline.audioTracks
    : [];
  const captions = Array.isArray(timeline.captions) ? timeline.captions : [];
  return (
    scenes.length > 12 ||
    tracks.length > 4 ||
    captions.length > 100 ||
    scenes.reduce(
      (frames, scene) => frames + (Number(scene?.durationFrames) || 0),
      0,
    ) > 1800 ||
    scenes.some(
      (scene) =>
        (Number(scene?.motionOffsetFrames) || 0) +
          (Number(scene?.durationFrames) || 0) >
        1800,
    ) ||
    tracks.some(
      (track) =>
        Number(track?.startFrame) > 1799 ||
        Number(track?.durationFrames) > 1800,
    ) ||
    captions.some((caption) => Number(caption?.endFrame) > 1800)
  );
}
