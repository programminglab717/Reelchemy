import { timelineSchema, type Timeline, type Caption } from "./schema";
import { MAX_CAPTIONS, MAX_TIMELINE_FRAMES } from "./timeline-limits";

export function sceneNoteCues(
  text: string,
  startFrame: number,
  durationFrames: number,
  prefix: string = crypto.randomUUID(),
): Caption[] {
  if (text.length > 500 || prefix.length > 72)
    throw new Error("Scene notes must be 500 characters or less.");
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (!words.length)
    throw new Error("Write narration in Scene notes before creating captions.");
  const chunks: string[] = [];
  let current = "";
  for (const word of words) {
    if (word.length > 72)
      throw new Error(
        "A word in these notes is too long for a caption. Add spaces or shorten it first.",
      );
    if (current && current.length + word.length + 1 > 72) {
      chunks.push(current);
      current = "";
    }
    current += (current ? " " : "") + word;
  }
  if (current) chunks.push(current);
  if (
    !Number.isSafeInteger(startFrame) ||
    startFrame < 0 ||
    !Number.isSafeInteger(durationFrames) ||
    chunks.length * 15 > durationFrames ||
    startFrame + durationFrames > MAX_TIMELINE_FRAMES
  )
    throw new Error(
      "These notes need more reading time. Shorten them or lengthen the scene.",
    );
  return chunks.map((text, index) => ({
    id: `${prefix}-${index + 1}`,
    text,
    startFrame:
      startFrame + Math.floor((index * durationFrames) / chunks.length),
    endFrame:
      startFrame + Math.floor(((index + 1) * durationFrames) / chunks.length),
  }));
}

export function captionSceneNotes(timeline: Timeline, index: number): Timeline {
  const scene = timeline.scenes[index];
  if (!scene) throw new Error("Choose a scene before creating captions.");
  const start = timeline.scenes
      .slice(0, index)
      .reduce((frames, scene) => frames + scene.durationFrames, 0),
    end = start + scene.durationFrames;
  const overlaps = (timeline.captions || []).filter(
    (cue) => cue.startFrame < end && cue.endFrame > start,
  );
  if (overlaps.some((cue) => cue.startFrame < start || cue.endFrame > end))
    throw new Error(
      "A caption crosses this scene boundary. Split or trim it before replacing this scene's captions.",
    );
  const captions = [
    ...(timeline.captions || []).filter((cue) => !overlaps.includes(cue)),
    ...sceneNoteCues(scene.intent, start, scene.durationFrames),
  ].sort((a, b) => a.startFrame - b.startFrame);
  if (captions.length > MAX_CAPTIONS)
    throw new Error(
      `These notes would exceed ${MAX_CAPTIONS} captions. Remove or merge some cues first.`,
    );
  const result = timelineSchema.safeParse({ ...timeline, captions });
  if (!result.success)
    throw new Error(
      "These captions do not fit the saved film. Shorten the notes or reduce editing detail and try again.",
    );
  return result.data;
}
