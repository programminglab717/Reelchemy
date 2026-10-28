"use client";
import { KeyframeControls } from "./KeyframeControls";
import { MotionJson } from "./MotionJson";
import type { Scene } from "@/lib/schema";
export function CameraEditor({
  scene,
  onChange,
}: {
  scene: Scene;
  onChange: (s: Scene) => void;
}) {
  return (
    <details className="layer-row">
      <summary>Scene camera keyframes</summary>
      <p>
        Move or zoom the whole scene while captions stay fixed. Add keys at
        different frames, then inspect the result in Live preview. Reset returns
        to a fixed camera.
      </p>
      <KeyframeControls
        label="Camera"
        keys={scene.camera || []}
        durationFrames={scene.durationFrames}
        onChange={(camera) => onChange({ ...scene, camera })}
      />
      <MotionJson
        key={JSON.stringify(scene.camera)}
        camera
        keys={scene.camera || []}
        durationFrames={scene.durationFrames}
        onChange={(camera) => onChange({ ...scene, camera })}
      />
    </details>
  );
}
