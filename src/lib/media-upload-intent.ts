export const MEDIA_PROCESSING_EVENT = "reelchemy:media-processing";
import type { MediaKind } from "./timeline-limits";
export const mediaKindNames: Record<MediaKind, string> = {
  image: "Image",
  audio: "Audio",
  video: "Video",
  font: "Font",
};
export function mediaUploadName(name: string, kind: MediaKind) {
  return (
    (name.split("/").pop() || "")
      .replace(/[^a-zA-Z0-9._ -]/g, "_")
      .slice(0, 100) || mediaKindNames[kind]
  );
}
