import { isFontMime, type Project, type Timeline } from "./schema";
export type AssetUpdate = Pick<Project, "id" | "assets">;
export function validAssetId(id: string) {
  return /^[a-f0-9-]{36}$/.test(id);
}
export function validateProjectAssets(
  project: Pick<Project, "assets">,
  t: Timeline,
) {
  for (const scene of t.scenes)
    for (const layer of scene.layers)
      if (
        layer.assetId &&
        !project.assets?.some(
          (a) =>
            a.id === layer.assetId &&
            a.mime === (layer.kind === "video" ? "video/mp4" : "image/png"),
        )
      )
        throw new Error(
          "Visual assets must belong to this project and match the layer type.",
        );
  for (const scene of t.scenes)
    for (const id of scene.code?.assets || [])
      if (!project.assets?.some((a) => a.id === id && a.mime === "image/png"))
        throw new Error(
          "Images in a code scene must be images uploaded to this project.",
        );
  for (const scene of t.scenes)
    for (const layer of scene.layers)
      if (
        layer.fontAssetId &&
        !project.assets?.some(
          (a) => a.id === layer.fontAssetId && isFontMime(a.mime),
        )
      )
        throw new Error("Text fonts must be fonts uploaded to this project.");
  for (const scene of t.scenes)
    for (const layer of scene.layers)
      if (layer.kind === "video") {
        const asset = project.assets?.find((a) => a.id === layer.assetId),
          clip = layer.video;
        if (
          !clip ||
          clip.offsetFrames + clip.durationFrames > (asset?.durationFrames || 0)
        )
          throw new Error("Video trim exceeds the source duration.");
        if (clip.audio && !asset?.hasAudio)
          throw new Error("This video has no source audio.");
      }
  for (const track of t.audioTracks || []) {
    const asset = project.assets?.find((a) => a.id === track.assetId);
    if (asset?.mime !== "audio/wav")
      throw new Error(
        "Audio tracks must reference audio uploaded to this project.",
      );
    if (track.offsetFrames + track.durationFrames > (asset.durationFrames || 0))
      throw new Error("Audio trim exceeds the source duration.");
  }
}
