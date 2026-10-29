"use client";
import { useRef, useState, type PointerEvent } from "react";
import {
  editTrack,
  type TrackRange,
  type TrackBounds,
  type TrackAction,
} from "@/lib/track-edit";
export function TimedTrack({
  label,
  range,
  bounds,
  totalFrames,
  onChange,
  disabled = false,
  className = "",
  displayName,
}: {
  label: string;
  range: TrackRange;
  bounds: TrackBounds;
  totalFrames: number;
  onChange: (range: TrackRange) => void;
  disabled?: boolean;
  className?: string;
  displayName?: string;
}) {
  const lane = useRef<HTMLDivElement>(null);
  const gesture = useRef<{
    range: TrackRange;
    x: number;
    width: number;
    action: TrackAction;
  } | null>(null);
  const [draft, setDraft] = useState<TrackRange | null>(null);
  const shown = draft || range;
  function position(e: PointerEvent<HTMLButtonElement>) {
    const g = gesture.current;
    return g
      ? editTrack(
          g.range,
          ((e.clientX - g.x) / g.width) * totalFrames,
          g.action,
          bounds,
        )
      : null;
  }
  function end(e: PointerEvent<HTMLButtonElement>) {
    const next = position(e),
      g = gesture.current;
    gesture.current = null;
    setDraft(null);
    if (e.currentTarget.hasPointerCapture(e.pointerId))
      e.currentTarget.releasePointerCapture(e.pointerId);
    if (next && g && JSON.stringify(g.range) === JSON.stringify(range))
      onChange(next);
  }
  return (
    <div
      className={`timeline-track timed-track ${className}`}
      aria-label={`${label} track`}
      ref={lane}
    >
      <div
        className="timed-clip"
        style={{
          left: `${(shown.startFrame / totalFrames) * 100}%`,
          width: `${(shown.durationFrames / totalFrames) * 100}%`,
        }}
      >
        {(
          [
            ["start", `Trim start ${label}`, "‹"],
            ["move", `Move ${label}`, displayName || label],
            ["end", `Trim end ${label}`, "›"],
          ] as const
        ).map(([action, name, text]) => (
          <button
            key={action}
            type="button"
            aria-label={name}
            title={`${name} · drag or use arrow keys (Shift: ten frames)`}
            disabled={disabled}
            className={action === "move" ? "track-body" : "track-handle"}
            onPointerDown={(e) => {
              if (e.button !== 0 || disabled || e.currentTarget.disabled)
                return;
              e.preventDefault();
              e.currentTarget.focus();
              gesture.current = {
                range,
                x: e.clientX,
                width: lane.current!.getBoundingClientRect().width,
                action,
              };
              e.currentTarget.setPointerCapture(e.pointerId);
            }}
            onPointerMove={(e) => {
              const next = position(e);
              if (next) setDraft(next);
            }}
            onPointerUp={end}
            onPointerCancel={() => {
              gesture.current = null;
              setDraft(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                gesture.current = null;
                setDraft(null);
                return;
              }
              if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
              e.preventDefault();
              e.stopPropagation();
              onChange(
                editTrack(
                  range,
                  (e.key === "ArrowLeft" ? -1 : 1) * (e.shiftKey ? 10 : 1),
                  action,
                  bounds,
                ),
              );
            }}
          >
            {text}
          </button>
        ))}
      </div>
    </div>
  );
}
