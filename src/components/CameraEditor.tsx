"use client";
import { useState } from "react";
import { sceneSchema, type Scene } from "@/lib/schema";
export function CameraEditor({
  scene,
  onChange,
}: {
  scene: Scene;
  onChange: (s: Scene) => void;
}) {
  const [text, setText] = useState(JSON.stringify(scene.camera || [], null, 2)),
    [error, setError] = useState("");
  return (
    <details className="layer-row">
      <summary>Scene camera keyframes</summary>
      <p>
        Move/zoom the whole scene; captions stay fixed. Frame, x/y canvas
        offset, scale and opacity. Use an empty array to reset.
      </p>
      <textarea
        aria-label="Camera keyframe JSON"
        rows={5}
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <button
        className="subtle"
        onClick={() => {
          try {
            const camera = JSON.parse(text);
            const next = sceneSchema.parse({ ...scene, camera });
            if (
              next.camera?.some(
                (k, i, a) =>
                  k.frame >= scene.durationFrames ||
                  (i > 0 && k.frame <= a[i - 1].frame),
              )
            )
              throw new Error();
            onChange(next);
            setError("");
          } catch {
            setError(
              "Camera keys must be valid, increase strictly, and fit the scene.",
            );
          }
        }}
      >
        Apply camera motion
      </button>
      {error && <p role="alert">{error}</p>}
    </details>
  );
}
