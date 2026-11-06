export const MAX_TIMELINE_SECONDS = 300;
export const MAX_TIMELINE_FRAMES = MAX_TIMELINE_SECONDS * 30;
// Individual uploaded footage/audio files and microphone takes may be as long
// as the longest film, so a whole narration can be one continuous source.
export const MAX_SOURCE_SECONDS = 300;
export const MAX_SOURCE_FRAMES = MAX_SOURCE_SECONDS * 30;
// Upload size limits shared by browser checks and server admission. Files
// larger than one upload chunk are sent in pieces, so these limits are not
// bound by a proxy's per-request body limit (Cloudflare: 100 MB on Free/Pro).
const MiB = 1024 * 1024;
export const MAX_MEDIA_UPLOAD_BYTES = {
  image: 25 * MiB,
  audio: 256 * MiB,
  video: 2048 * MiB,
  font: 5 * MiB,
} as const;
// Normalized media actually stored for a project. Video is bitrate-capped
// during normalization so five minutes of 1080p stays within this bound.
export const MAX_STORED_MEDIA_BYTES = {
  image: 20 * MiB,
  audio: 64 * MiB,
  video: 200 * MiB,
  font: 5 * MiB,
} as const;
export const MAX_STORED_ASSET_BYTES = Math.max(
  ...Object.values(MAX_STORED_MEDIA_BYTES),
);
// Portable project archives (ZIP): import and download ceiling.
export const MAX_ARCHIVE_BYTES = 256 * MiB;
// One upload request carries at most this much file data.
export const UPLOAD_CHUNK_BYTES = 32 * MiB;
export const mediaKinds = ["image", "audio", "video", "font"] as const;
export type MediaKind = (typeof mediaKinds)[number];
export function byteLimitText(bytes: number) {
  return bytes >= 1024 * MiB && bytes % (1024 * MiB) === 0
    ? `${bytes / (1024 * MiB)} GB`
    : `${Math.round(bytes / MiB)} MB`;
}
export const mediaUploadLimitText = (kind: MediaKind) =>
  byteLimitText(MAX_MEDIA_UPLOAD_BYTES[kind]);
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
