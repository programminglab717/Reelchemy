"use client";
import { useEffect, useRef, useState } from "react";
import type { Layer } from "@/lib/schema";
export function MediaFitControls({
  layer,
  onChange,
  onPreview,
}: {
  layer: Layer;
  onChange: (layer: Layer) => void;
  onPreview?: (layer: Layer | null) => void;
}) {
  const [draft, setDraft] = useState<NonNullable<
    Layer["mediaPosition"]
  > | null>(null);
  const gesture = useRef<{
    snapshot: string;
    position: NonNullable<Layer["mediaPosition"]>;
  } | null>(null);
  const position = draft || layer.mediaPosition || { x: 0.5, y: 0.5 };
  const fit =
    layer.kind === "video"
      ? layer.video?.fit || "contain"
      : layer.imageFit || "contain";
  useEffect(() => () => onPreview?.(null), [onPreview]);
  function cancel() {
    gesture.current = null;
    setDraft(null);
    onPreview?.(null);
  }
  function set(axis: "x" | "y", value: number) {
    const next = { ...position, [axis]: value };
    if (gesture.current) {
      gesture.current.position = next;
      setDraft(next);
      onPreview?.({ ...layer, mediaPosition: next });
    } else onChange({ ...layer, mediaPosition: next });
  }
  function commit() {
    const current = gesture.current;
    cancel();
    if (current && current.snapshot === JSON.stringify(layer))
      onChange({ ...layer, mediaPosition: current.position });
  }
  return (
    <div className="media-fit-controls" role="group" aria-label="Media framing">
      <h3>Media framing</h3>
      <div className="layer-fields">
        <label>
          Fit
          <select
            aria-label="Media fit"
            value={fit}
            onChange={(e) => {
              const next = e.target.value as "contain" | "cover";
              onChange(
                layer.kind === "video" && layer.video
                  ? { ...layer, video: { ...layer.video, fit: next } }
                  : { ...layer, imageFit: next },
              );
            }}
          >
            <option value="contain">Fit entire image / clip</option>
            <option value="cover">Fill and crop</option>
          </select>
        </label>
        {(["x", "y"] as const).map((axis) => (
          <label key={axis}>
            {axis === "x" ? "Horizontal" : "Vertical"} framing ·{" "}
            {Math.round(position[axis] * 100)}%
            <input
              aria-label={
                axis === "x"
                  ? "Horizontal media framing"
                  : "Vertical media framing"
              }
              type="range"
              min={0}
              max={100}
              step={1}
              value={position[axis] * 100}
              onPointerDown={(e) => {
                if (e.button !== 0) return;
                gesture.current = { snapshot: JSON.stringify(layer), position };
                e.currentTarget.setPointerCapture(e.pointerId);
              }}
              onChange={(e) => set(axis, Number(e.target.value) / 100)}
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
        ))}
        <button
          className="subtle"
          type="button"
          onClick={() => {
            cancel();
            onChange({ ...layer, mediaPosition: undefined });
          }}
        >
          Center media
        </button>
      </div>
      <p>
        Fit keeps the complete source. Fill crops to the layer box; move the
        framing sliders to choose which part stays visible. The source file is
        kept intact. Slider drags preview on the canvas and commit as one undo
        step.
      </p>
    </div>
  );
}
