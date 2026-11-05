"use client";
import { MAX_SCENES } from "@/lib/timeline-limits";
import { TimedTrack } from "./TimedTrack";
import { AudioWaveform } from "./AudioWaveform";
import { useEffect, useState, type RefObject } from "react";
import type { PlayerRef } from "@remotion/player";
import { totalFrames, type Timeline, type Asset } from "@/lib/schema";
import { splitScene } from "@/lib/timeline-edit";

export function TimelineEditor({
  timeline,
  selected,
  onSelect,
  player,
  inFrame,
  outFrame,
  onChange,
  assets,
  projectId,
}: {
  timeline: Timeline;
  selected: number;
  onSelect: (index: number) => void;
  player: RefObject<PlayerRef | null>;
  inFrame: number;
  outFrame: number;
  onChange: (t: Timeline) => void;
  assets: Asset[];
  projectId: string;
}) {
  const [frame, setFrame] = useState(0),
    [zoom, setZoom] = useState(1);
  const duration = totalFrames(timeline);
  useEffect(() => {
    const ref = player.current;
    if (!ref) return;
    const update = ({ detail }: { detail: { frame: number } }) =>
      setFrame(detail.frame);
    ref.addEventListener("frameupdate", update);
    return () => ref.removeEventListener("frameupdate", update);
  }, [player, timeline, inFrame, outFrame]);
  const scenes = timeline.scenes.map((s, index) => {
    return {
      ...s,
      start: timeline.scenes
        .slice(0, index)
        .reduce((n, prior) => n + prior.durationFrames, 0),
      index,
    };
  });
  const marker = (n: number) => `${(n / duration) * 100}%`;
  return (
    <section
      id="studio-tool-timeline"
      tabIndex={-1}
      className="layer-editor timeline-editor"
    >
      <div className="panel-heading">
        <h2>Timeline</h2>
        <output aria-label="Playhead time">
          {(Math.min(outFrame, Math.max(inFrame, frame)) / 30).toFixed(2)}s /{" "}
          {(duration / 30).toFixed(2)}s
        </output>
        <label>
          Zoom{" "}
          <input
            aria-label="Timeline zoom"
            type="range"
            min={1}
            max={Math.max(4, Math.ceil(duration / 1800) * 4)}
            step={0.5}
            value={zoom}
            onChange={(e) => setZoom(Number(e.target.value))}
          />
        </label>
        <button
          className="subtle"
          disabled={
            timeline.scenes.length >= MAX_SCENES ||
            frame - scenes[selected].start < 30 ||
            frame - scenes[selected].start >
              scenes[selected].durationFrames - 30
          }
          onClick={() =>
            onChange(
              splitScene(timeline, selected, frame - scenes[selected].start),
            )
          }
        >
          Split scene at playhead
        </button>
      </div>
      <div className="timeline-scroll">
        <div className="timeline-content" style={{ width: `${zoom * 100}%` }}>
          <label className="scrub-label">
            Playhead
            <input
              aria-label="Timeline playhead"
              type="range"
              min={inFrame}
              max={outFrame}
              value={Math.min(outFrame, Math.max(inFrame, frame))}
              onChange={(e) => {
                const f = Number(e.target.value);
                setFrame(f);
                player.current?.pause();
                player.current?.seekTo(f);
              }}
            />
          </label>
          <div className="timeline-track" aria-label="Scene track">
            {scenes.map((s) => (
              <button
                key={s.id}
                aria-label={`Timeline scene ${s.index + 1}: ${s.title}`}
                aria-pressed={selected === s.index}
                className={selected === s.index ? "selected" : ""}
                style={{
                  left: marker(s.start),
                  width: marker(s.durationFrames),
                  background: s.background,
                  color: s.accent,
                }}
                onClick={() => {
                  onSelect(s.index);
                  player.current?.pause();
                  player.current?.seekTo(
                    s.start + Math.min(15, s.durationFrames - 1),
                  );
                }}
              >
                {s.index + 1} · {s.title}
                <small>{(s.durationFrames / 30).toFixed(1)}s</small>
              </button>
            ))}
          </div>
          {(timeline.audioTracks || []).map((track, i) => (
            <TimedTrack
              key={`audio-${track.id}`}
              label={`Audio ${i + 1}`}
              displayName={
                assets.find((a) => a.id === track.assetId)?.name ||
                `Audio ${i + 1}`
              }
              range={track}
              totalFrames={duration}
              bounds={{
                minFrame: 0,
                maxFrame: duration,
                sourceFrames:
                  assets.find((a) => a.id === track.assetId)?.durationFrames ||
                  0,
              }}
              className="media-track"
              media={(range) => (
                <AudioWaveform
                  src={`/api/projects/${projectId}/assets/${track.assetId}/waveform`}
                  range={range}
                  volume={track.volume}
                />
              )}
              onChange={(range) =>
                onChange({
                  ...timeline,
                  audioTracks: timeline.audioTracks!.map((old) =>
                    old.id === track.id
                      ? {
                          ...old,
                          ...range,
                          fadeFrames: Math.min(
                            old.fadeFrames,
                            Math.floor(range.durationFrames / 2),
                          ),
                        }
                      : old,
                  ),
                })
              }
            />
          ))}
          {scenes.flatMap((s) =>
            s.layers.flatMap((l, i) =>
              l.kind !== "video" || !l.video
                ? []
                : [
                    <TimedTrack
                      key={`footage-${s.id}-${l.id}`}
                      label={`Footage ${s.index + 1}.${i + 1}`}
                      displayName={`${assets.find((a) => a.id === l.assetId)?.name || "Footage"}${l.hidden ? " (hidden)" : ""}`}
                      disabled={l.locked}
                      range={{
                        ...l.video,
                        startFrame: s.start + l.video.startFrame,
                      }}
                      totalFrames={duration}
                      bounds={{
                        minFrame: s.start,
                        maxFrame: s.start + s.durationFrames,
                        sourceFrames:
                          assets.find((a) => a.id === l.assetId)
                            ?.durationFrames || 0,
                      }}
                      className="footage-track"
                      media={
                        assets.find((a) => a.id === l.assetId)?.hasAudio
                          ? (range) => (
                              <AudioWaveform
                                src={`/api/projects/${projectId}/assets/${l.assetId}/waveform`}
                                range={range}
                                volume={
                                  l.video!.audio && !l.hidden
                                    ? l.video!.volume
                                    : 0
                                }
                              />
                            )
                          : undefined
                      }
                      onChange={(range) =>
                        onChange({
                          ...timeline,
                          scenes: timeline.scenes.map((scene, j) =>
                            j !== s.index
                              ? scene
                              : {
                                  ...scene,
                                  layers: scene.layers.map((old) =>
                                    old.id !== l.id
                                      ? old
                                      : {
                                          ...old,
                                          video: {
                                            ...old.video!,
                                            ...range,
                                            startFrame:
                                              range.startFrame - s.start,
                                          },
                                        },
                                  ),
                                },
                          ),
                        })
                      }
                    />,
                  ],
            ),
          )}
          {duration > 1800 && (timeline.captions || []).length > 0 && (
            <p>
              Caption tracks for {scenes[selected].title}. Select another scene
              to edit its captions.
            </p>
          )}
          {[...(timeline.captions || [])]
            .sort((a, b) => a.startFrame - b.startFrame)
            .map((cue, i, cues) =>
              duration > 1800 &&
              (cue.endFrame <= scenes[selected].start ||
                cue.startFrame >=
                  scenes[selected].start +
                    scenes[selected].durationFrames) ? null : (
                <TimedTrack
                  key={`caption-${cue.id}`}
                  label={`Caption ${i + 1}`}
                  displayName={cue.text}
                  range={{
                    startFrame: cue.startFrame,
                    offsetFrames: 0,
                    durationFrames: cue.endFrame - cue.startFrame,
                  }}
                  totalFrames={duration}
                  bounds={{
                    minFrame: cues[i - 1]?.endFrame || 0,
                    maxFrame: cues[i + 1]?.startFrame ?? duration,
                  }}
                  className="caption-track"
                  onChange={(range) =>
                    onChange({
                      ...timeline,
                      captions: timeline.captions!.map((old) =>
                        old.id === cue.id
                          ? {
                              ...old,
                              startFrame: range.startFrame,
                              endFrame: range.startFrame + range.durationFrames,
                            }
                          : old,
                      ),
                    })
                  }
                />
              ),
            )}
          <div className="timeline-ruler">
            <span>0s</span>
            <span>{(duration / 60).toFixed(1)}s</span>
            <span>{(duration / 30).toFixed(1)}s</span>
          </div>
        </div>
      </div>
      <p>
        Select a scene to arrange it. Split at the playhead with at least one
        second on each side. Clip controls below adjust source in, start and
        length; audio/caption timing stays on the same global frames.
      </p>
    </section>
  );
}
