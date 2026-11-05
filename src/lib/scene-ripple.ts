import { timelineSchema, type Timeline, type AudioTrack } from "./schema";
import { MAX_AUDIO_TRACKS } from "./timeline-limits";

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
  const start = timeline.scenes
      .slice(0, index)
      .reduce((n, s) => n + s.durationFrames, 0),
    duration = timeline.scenes[index].durationFrames,
    end = start + duration;
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
  const result = timelineSchema.safeParse({
    ...timeline,
    scenes: timeline.scenes.filter((_, i) => i !== index),
    ...(audioTracks ? { audioTracks } : {}),
    ...(captions ? { captions } : {}),
  });
  if (!result.success)
    throw new Error(
      "This cut exceeds the saved film limits. Reduce audio or editing detail and try again.",
    );
  return result.data;
}
