"use client";
import { useState } from "react";
import { keyframeMotion, type Layer } from "@/lib/schema";
type Keys = NonNullable<Layer["keyframes"]>;
export function KeyframeControls({
  keys,
  durationFrames,
  label,
  onChange,
}: {
  keys: Keys;
  durationFrames: number;
  label: string;
  onChange: (keys: Keys) => void;
}) {
  const [cursor, setCursor] = useState(0);
  const frame = Math.min(cursor, durationFrames - 1);
  const key = keys.find((k) => k.frame === frame);
  const value = key || { frame, ...keyframeMotion(keys, frame) };
  const full = keys.length >= 30 && !key;
  function set(patch: Partial<Keys[number]> = {}) {
    if (full) return;
    const next = {
      frame,
      x: value.x,
      y: value.y,
      scale: value.scale,
      opacity: value.opacity,
      ...patch,
    };
    onChange(
      [...keys.filter((k) => k.frame !== frame), next].sort(
        (a, b) => a.frame - b.frame,
      ),
    );
  }
  return (
    <div className="keyframe-controls" aria-label={`${label} visual keyframes`}>
      <div className="keyframe-strip" aria-label={`${label} keyframe markers`}>
        {keys.map((k) => (
          <button
            type="button"
            key={k.frame}
            aria-label={`Select ${label} key at frame ${k.frame}`}
            aria-pressed={k.frame === frame}
            style={{
              left: `${(k.frame / Math.max(1, durationFrames - 1)) * 100}%`,
            }}
            onClick={() => setCursor(k.frame)}
          >
            ◆
          </button>
        ))}
      </div>
      <div className="layer-fields">
        <label>
          Frame{" "}
          <input
            aria-label={`${label} motion frame`}
            type="range"
            min={0}
            max={durationFrames - 1}
            step={1}
            value={frame}
            onChange={(e) => setCursor(Number(e.target.value))}
          />
          <output>
            {frame} · {(frame / 30).toFixed(2)}s
          </output>
        </label>
        <button
          className="subtle"
          type="button"
          disabled={full || !!key}
          onClick={() => set()}
        >
          Add {label} keyframe
        </button>
        <button
          className="subtle"
          type="button"
          disabled={!key}
          onClick={() => onChange(keys.filter((k) => k.frame !== frame))}
        >
          Remove {label} keyframe
        </button>
        <button
          className="subtle"
          type="button"
          disabled={!keys.length}
          onClick={() => onChange([])}
        >
          Reset {label} motion
        </button>
      </div>
      <div className="layer-fields">
        {(
          [
            ["x", "Horizontal offset", -1, 1, 0.01],
            ["y", "Vertical offset", -1, 1, 0.01],
            ["scale", "Scale", 0.1, 3, 0.01],
            ["opacity", "Opacity", 0, 1, 0.01],
          ] as const
        ).map(([field, name, min, max, step]) => (
          <label key={field}>
            {name}
            <input
              aria-label={`${label} ${name.toLowerCase()}`}
              type="number"
              min={min}
              max={max}
              step={step}
              value={Math.round(value[field] * 10000) / 10000}
              disabled={full}
              onChange={(e) => {
                const n = Number(e.target.value);
                if (Number.isFinite(n) && n >= min && n <= max)
                  set({ [field]: n });
              }}
            />
          </label>
        ))}
      </div>
      <p>
        {key
          ? "Editing a saved keyframe."
          : "Changing a value creates a key at this frame using the interpolated pose."}{" "}
        Motion interpolates linearly between keys. Reset removes custom keys.{" "}
        {full && "The limit is 30 keys; select an existing key to edit it."}
      </p>
    </div>
  );
}
