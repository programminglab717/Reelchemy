import { timelineSchema, type Timeline, type AudioTrack } from "./schema";
import { MAX_AUDIO_TRACKS } from "./timeline-limits";

// Removes the global interval [start, start + duration): audio crossing it is
// split around the cut and captions inside it collapse. Scene-local
// visual/source/motion coordinates are not touched.
function closeGap(timeline: Timeline, start: number, duration: number) {
  const end = start + duration;
  const position = (frame: number) =>
    frame <= start ? frame : frame >= end ? frame - duration : start;
  const audioTracks = timeline.audioTracks?.flatMap((track): AudioTrack[] => {
    const finish = track.startFrame + track.durationFrames;
    if (finish <= start) return [track];
    if (track.startFrame >= end)
      return [{ ...track, startFrame: track.startFrame - duration }];
    const pieces: AudioTrack[] = [];
    if (track.startFrame < start) {
      const frames = start - track.startFrame;
      pieces.push({
        ...track,
        durationFrames: frames,
        fadeFrames: Math.min(track.fadeFrames, Math.floor(frames / 2)),
      });
    }
    if (finish > end) {
      const frames = finish - end;
      pieces.push({
        ...track,
        id: pieces.length ? crypto.randomUUID() : track.id,
        startFrame: start,
        offsetFrames: track.offsetFrames + end - track.startFrame,
        durationFrames: frames,
        fadeFrames: Math.min(track.fadeFrames, Math.floor(frames / 2)),
      });
    }
    return pieces;
  });
  if (audioTracks && audioTracks.length > MAX_AUDIO_TRACKS)
    throw new Error(
      `This cut would need more than ${MAX_AUDIO_TRACKS} audio tracks. Shorten or remove a track crossing this scene, then try again.`,
    );
  const captions = timeline.captions?.flatMap((cue) => {
    const startFrame = position(cue.startFrame),
      endFrame = position(cue.endFrame);
    return endFrame > startFrame ? [{ ...cue, startFrame, endFrame }] : [];
  });
  return {
    ...(audioTracks ? { audioTracks } : {}),
    ...(captions ? { captions } : {}),
  };
}
function sceneStart(timeline: Timeline, index: number) {
  return timeline.scenes
    .slice(0, index)
    .reduce((n, s) => n + s.durationFrames, 0);
}
// Close the deleted scene's global interval. Scene-local visual/source/motion
// coordinates remain intact; global captions/audio follow the surviving film.
export function deleteSceneAndCloseGap(
  timeline: Timeline,
  index: number,
): Timeline {
  if (!Number.isInteger(index) || !timeline.scenes[index])
    throw new Error("Choose a scene before deleting it.");
  if (timeline.scenes.length <= 1)
    throw new Error("Keep at least one scene in your film.");
  const result = timelineSchema.safeParse({
    ...timeline,
    scenes: timeline.scenes.filter((_, i) => i !== index),
    ...closeGap(
      timeline,
      sceneStart(timeline, index),
      timeline.scenes[index].durationFrames,
    ),
  });
  if (!result.success)
    throw new Error(
      "This cut exceeds the saved film limits. Reduce audio or editing detail and try again.",
    );
  return result.data;
}
// Change a scene's length and keep later audio and captions in sync with the
// scenes after it. Shortening removes the scene's trailing frames from the
// global timeline exactly like a cut; lengthening pushes everything that
// starts at or after the old scene end later, leaving items that are already
// playing across the boundary where they are.
export function resizeSceneWithRipple(
  timeline: Timeline,
  index: number,
  durationFrames: number,
): Timeline {
  const scene = timeline.scenes[index];
  if (!scene) throw new Error("Choose a scene before changing its length.");
  const end = sceneStart(timeline, index) + scene.durationFrames,
    delta = durationFrames - scene.durationFrames;
  const scenes = timeline.scenes.map((s, i) =>
    i === index ? { ...s, durationFrames } : s,
  );
  const tracks =
    delta < 0
      ? closeGap(timeline, end + delta, -delta)
      : {
          ...(timeline.audioTracks
            ? {
                audioTracks: timeline.audioTracks.map((track) =>
                  track.startFrame >= end
                    ? { ...track, startFrame: track.startFrame + delta }
                    : track,
                ),
              }
            : {}),
          ...(timeline.captions
            ? {
                captions: timeline.captions.map((cue) =>
                  cue.startFrame >= end
                    ? {
                        ...cue,
                        startFrame: cue.startFrame + delta,
                        endFrame: cue.endFrame + delta,
                      }
                    : cue,
                ),
              }
            : {}),
        };
  const result = timelineSchema.safeParse({ ...timeline, scenes, ...tracks });
  if (!result.success)
    throw new Error(
      result.error.issues.map((issue) => issue.message).join(" ") ||
        "This length exceeds the saved film limits.",
    );
  return result.data;
}
