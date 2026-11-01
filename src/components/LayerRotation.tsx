"use client";
import { Icon } from "./Icon";
import { useEffect, useRef, useState } from "react";
import type { Layer } from "@/lib/schema";
export function LayerRotation({
  layer,
  label,
  onChange,
  onPreview,
}: {
  layer: Layer;
  label: string;
  onChange: (layer: Layer) => void;
  onPreview?: (layer: Layer | null) => void;
}) {
  const [draft, setDraft] = useState<number | null>(null);
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState("");
  const gesture = useRef<{ snapshot: string; value: number } | null>(null);
  const angle = draft ?? layer.rotation ?? 0;
  useEffect(() => () => onPreview?.(null), [onPreview]);
  const rotated = (value: number): Layer => ({
    ...layer,
    rotation: value || undefined,
  });
  function cancel() {
    gesture.current = null;
    setDraft(null);
    setText(null);
    onPreview?.(null);
  }
  function begin() {
    gesture.current = { snapshot: JSON.stringify(layer), value: angle };
    setError("");
  }
  function set(value: number) {
    if (!Number.isFinite(value) || value < -180 || value > 180) return;
    if (gesture.current) {
      gesture.current.value = value;
      setDraft(value);
      onPreview?.(rotated(value));
    } else onChange(rotated(value));
  }
  function commit() {
    const current = gesture.current;
    cancel();
    if (current && current.snapshot === JSON.stringify(layer))
      onChange(rotated(current.value));
  }
  function apply(value: number) {
    cancel();
    setError("");
    onChange(rotated(value));
  }
  return (
    <div
      className="media-fit-controls"
      role="group"
      aria-label={`${label} controls`}
    >
      <h3>Rotation · {angle}°</h3>
      <div className="layer-fields">
        <label>
          Angle
          <input
            aria-label={`${label} slider`}
            type="range"
            min={-180}
            max={180}
            step={1}
            value={angle}
            onPointerDown={(e) => {
              if (e.button !== 0) return;
              begin();
              e.currentTarget.setPointerCapture(e.pointerId);
            }}
            onChange={(e) => {
              setError("");
              set(Number(e.target.value));
            }}
            onPointerUp={commit}
            onPointerCancel={cancel}
            onLostPointerCapture={() => {
              if (gesture.current) cancel();
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                cancel();
              }
            }}
          />
        </label>
        <label>
          Degrees
          <input
            aria-label={`${label} degrees`}
            type="number"
            min={-180}
            max={180}
            step={1}
            value={text ?? String(angle)}
            onFocus={() => {
              begin();
              setText(String(angle));
            }}
            onChange={(e) => {
              setText(e.target.value);
              if (e.target.value.trim()) set(Number(e.target.value));
            }}
            onBlur={() => {
              if (!gesture.current) return;
              if (
                text !== null &&
                (!text.trim() ||
                  !Number.isFinite(Number(text)) ||
                  Number(text) < -180 ||
                  Number(text) > 180)
              ) {
                cancel();
                setError("Use an angle from −180° to 180°.");
              } else commit();
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                e.currentTarget.blur();
              } else if (e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                cancel();
                e.currentTarget.blur();
              }
            }}
          />
        </label>
        <button
          type="button"
          className="subtle"
          aria-label={`${label} rotate left`}
          onClick={() => {
            apply(((angle - 90 + 180 + 360) % 360) - 180);
          }}
        >
          <Icon name="rotate-left" size={14} /> 90°
        </button>
        <button
          type="button"
          className="subtle"
          aria-label={`${label} rotate right`}
          onClick={() => {
            apply(((angle + 90 + 180) % 360) - 180);
          }}
        >
          <Icon name="rotate-right" size={14} /> 90°
        </button>
        <button
          type="button"
          className="subtle"
          onClick={() => {
            apply(0);
          }}
        >
          Reset rotation
        </button>
      </div>
      {error && <p role="alert">{error}</p>}
      <p>
        Rotate around the layer center. Canvas slider drags preview and commit
        as one undo step; Escape cancels. Rotated content can extend beyond the
        canvas and be cropped; adjust its size or position to keep it visible.
      </p>
    </div>
  );
}
