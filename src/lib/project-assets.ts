import type { Project, Timeline } from "./schema";
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
