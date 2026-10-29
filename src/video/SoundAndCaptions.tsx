import { clipAudioTracks } from "../lib/clip-audio";
import React from "react";
import { Audio, Sequence, useCurrentFrame } from "remotion";
import { captionAt } from "../lib/captions";
import { audioGain } from "../lib/audio-math";
import type { Timeline } from "../lib/schema";
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
        <div
          data-caption-id={caption.id}
          style={{
            position: "absolute",
            left: "8%",
            bottom: "3%",
            width: "84%",
            height: "16%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontFamily: "Arial, sans-serif",
            fontSize: 28,
            lineHeight: 1.2,
            color: "white",
            whiteSpace: "pre-wrap",
            overflowWrap: "anywhere",
            textAlign: "center",
            padding: "8px 18px",
            background: "#000000DD",
            borderRadius: 12,
          }}
        >
          {caption.text}
        </div>
      )}
    </>
  );
}
