export const MEDIA_PROCESSING_EVENT = "reelchemy:media-processing";
export function mediaUploadName(
  name: string,
  kind: "image" | "audio" | "video",
) {
  return (
    (name.split("/").pop() || "")
      .replace(/[^a-zA-Z0-9._ -]/g, "_")
      .slice(0, 100) ||
    (kind === "video" ? "Video" : kind === "audio" ? "Audio" : "Image")
  );
}
