"use client";
import { useEffect, useState, type RefObject } from "react";
import type { PlayerRef } from "@remotion/player";
import { totalFrames, type Timeline } from "@/lib/schema";

export function TimelineEditor({
  timeline,
  selected,
  onSelect,
  player,
  inFrame,
  outFrame,
}: {
  timeline: Timeline;
  selected: number;
  onSelect: (index: number) => void;
  player: RefObject<PlayerRef | null>;
  inFrame: number;
  outFrame: number;
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
    <section className="layer-editor timeline-editor">
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
            max={4}
            step={0.5}
            value={zoom}
            onChange={(e) => setZoom(Number(e.target.value))}
          />
        </label>
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
          {(timeline.audioTracks || []).map((t, i) => (
            <div
              key={t.id}
              className="timeline-track media-track"
              aria-label={`Audio track ${i + 1}`}
            >
              <span
                style={{
                  left: marker(t.startFrame),
                  width: marker(t.durationFrames),
                }}
              >
                Audio {i + 1} · {t.volume.toFixed(1)} gain
              </span>
            </div>
          ))}
          {!!timeline.captions?.length && (
            <div
              className="timeline-track caption-track"
              aria-label="Caption track"
            >
              {timeline.captions.map((c) => (
                <span
                  key={c.id}
                  title={c.text}
                  style={{
                    left: marker(c.startFrame),
                    width: marker(c.endFrame - c.startFrame),
                  }}
                >
                  {c.text}
                </span>
              ))}
            </div>
          )}
          <div className="timeline-ruler">
            <span>0s</span>
            <span>{(duration / 60).toFixed(1)}s</span>
            <span>{(duration / 30).toFixed(1)}s</span>
          </div>
        </div>
      </div>
      <p>
        Select a scene to arrange it. Audio and caption bars show saved timing;
        use the media controls below to adjust their ranges.
      </p>
    </section>
  );
}
