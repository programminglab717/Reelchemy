"use client";
import { useState } from "react";
import { z } from "zod";
import { keyframeSchema, type Layer } from "@/lib/schema";
export function MotionJson({
  keys,
  durationFrames,
  camera = false,
  onChange,
}: {
  keys: NonNullable<Layer["keyframes"]>;
  durationFrames: number;
  camera?: boolean;
  onChange: (keys: NonNullable<Layer["keyframes"]>) => void;
}) {
  const [draft, setDraft] = useState(JSON.stringify(keys, null, 2)),
    [error, setError] = useState("");
  return (
    <details>
      <summary>
        {camera ? "Advanced camera JSON" : "Advanced keyframe JSON"}
      </summary>
      <textarea
        aria-label={camera ? "Camera keyframe JSON" : "Keyframe JSON"}
        rows={6}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
      />
      <button
        type="button"
        className="subtle"
        onClick={() => {
          try {
            const next = z
              .array(keyframeSchema)
              .max(30)
              .parse(JSON.parse(draft));
            if (
              next.some(
                (k, i) =>
                  k.frame >= durationFrames ||
                  (i > 0 && k.frame <= next[i - 1].frame),
              )
            )
              throw new Error();
            onChange(next);
            setError("");
          } catch {
            setError(
              "Keys must be valid, increase strictly, and fit the scene.",
            );
          }
        }}
      >
        {camera ? "Apply camera motion" : "Apply keyframes"}
      </button>
      {error && <p role="alert">{error}</p>}
    </details>
  );
}
