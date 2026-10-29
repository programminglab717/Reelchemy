"use client";
import { useState } from "react";
import type { Layer, Asset } from "@/lib/schema";
export function VideoClipEditor({
  layer,
  asset,
  sceneFrames,
  onChange,
}: {
  layer: Layer;
  asset?: Asset;
  sceneFrames: number;
  onChange: (l: Layer) => void;
}) {
  const [error, setError] = useState("");
  const clip = layer.video;
  if (!clip) return null;
  function change(patch: Partial<NonNullable<Layer["video"]>>) {
    const next = { ...clip!, ...patch };
    if (
      next.startFrame + next.durationFrames > sceneFrames ||
      next.offsetFrames + next.durationFrames > (asset?.durationFrames || 0) ||
      next.durationFrames < 1
    ) {
      setError(
        "The clip must fit both the scene and source footage. Shorten its length first.",
      );
      return;
    }
    setError("");
    onChange({ ...layer, video: next });
  }
  return (
    <div className="video-clip-controls">
      <h3>Footage range</h3>
      <div className="layer-fields">
        {(
          [
            ["startFrame", "Clip start", 0],
            ["offsetFrames", "Source in", 0],
            ["durationFrames", "Clip length", 1 / 30],
          ] as const
        ).map(([field, label, min]) => (
          <label key={field}>
            {label} (seconds)
            <input
              aria-label={`${label} ${layer.id}`}
              type="number"
              step={1 / 30}
              min={min}
              max={
                (field === "offsetFrames"
                  ? asset?.durationFrames || 0
                  : sceneFrames) / 30
              }
              value={Number((clip[field] / 30).toFixed(4))}
              onChange={(e) => {
                const n = Number(e.target.value);
                if (Number.isFinite(n) && n >= min)
                  change({ [field]: Math.round(n * 30) });
              }}
            />
          </label>
        ))}
        <label>
          Fit
          <select
            aria-label={`Video fit ${layer.id}`}
            value={clip.fit}
            onChange={(e) =>
              change({ fit: e.target.value as "contain" | "cover" })
            }
          >
            <option value="contain">Fit entire clip</option>
            <option value="cover">Fill and crop</option>
          </select>
        </label>
        <label>
          Source volume
          <input
            aria-label={`Video volume ${layer.id}`}
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={clip.volume}
            disabled={!clip.audio}
            onChange={(e) => change({ volume: Number(e.target.value) })}
          />
        </label>
      </div>
      <p>
        Source: {((asset?.durationFrames || 0) / 30).toFixed(2)}s ·{" "}
        {clip.audio
          ? `${Math.round(clip.volume * 100)}% source audio`
          : "No source audio"}
        . Clip timing is quantized to 30 fps. Hidden video layers are also
        muted.
      </p>
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
