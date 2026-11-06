export const MAX_TIMELINE_SECONDS = 300;
export const MAX_TIMELINE_FRAMES = MAX_TIMELINE_SECONDS * 30;
// Individual uploaded footage/audio files and microphone takes may be as long
// as the longest film, so a whole narration can be one continuous source.
export const MAX_SOURCE_SECONDS = 300;
export const MAX_SOURCE_FRAMES = MAX_SOURCE_SECONDS * 30;
// Upload size limits shared by browser checks and server admission.
export const MAX_MEDIA_UPLOAD_BYTES = {
  image: 10 * 1024 * 1024,
  audio: 64 * 1024 * 1024,
  // Stays under Cloudflare's 100 MB request-body limit with form overhead.
  video: 95 * 1024 * 1024,
} as const;
export const mediaUploadLimitText = (kind: "image" | "audio" | "video") =>
  `${MAX_MEDIA_UPLOAD_BYTES[kind] / 1024 / 1024} MB`;
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
    captions.some((caption) => Number(caption?.endFrame) > 1800) ||
    // Sources longer than the former 120-second file limit (0.68+).
    tracks.some((track) => Number(track?.offsetFrames) > 3599) ||
    scenes.some(
      (scene) =>
        Array.isArray(scene?.layers) &&
        scene.layers.some(
          (layer: { video?: { offsetFrames?: unknown } } | null) =>
            Number(layer?.video?.offsetFrames) > 3599,
        ),
    )
  );
}
