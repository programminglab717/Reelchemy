import { clipAudioTracks } from "../lib/clip-audio";
import React from "react";
import { Audio, Sequence, useCurrentFrame } from "remotion";
import { captionAt } from "../lib/captions";
import { audioGain } from "../lib/audio-math";
import type { Timeline } from "../lib/schema";
import { CaptionOverlay } from "./CaptionOverlay";
export function SoundAndCaptions({
  timeline,
  assetSources,
}: {
  timeline: Timeline;
  assetSources: Record<string, string>;
}) {
  const frame = useCurrentFrame(),
    caption = captionAt(timeline, frame);
  return (
    <>
      {[...(timeline.audioTracks || []), ...clipAudioTracks(timeline)].map(
        (track, index) => (
          <Sequence
            key={`${index}-${track.id}`}
            from={track.startFrame}
            durationInFrames={track.durationFrames}
            layout="none"
          >
            <Audio
              src={assetSources[track.assetId]}
              trimBefore={track.offsetFrames}
              volume={(f) => audioGain(track, f)}
            />
          </Sequence>
        ),
      )}
      {caption && (
        <CaptionOverlay
          timeline={timeline}
          id={caption.id}
          text={caption.text}
        />
      )}
    </>
  );
}
