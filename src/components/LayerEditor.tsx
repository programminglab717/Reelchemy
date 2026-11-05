"use client";
import { MAX_SCENES, MAX_TIMELINE_FRAMES } from "@/lib/timeline-limits";
import { MotionJson } from "./MotionJson";
import { VideoClipEditor } from "./VideoClipEditor";
import { KeyframeControls } from "./KeyframeControls";
import { CameraEditor } from "./CameraEditor";
import { TypographyControls } from "./TypographyControls";
import { LayerRotation } from "./LayerRotation";
import { useState } from "react";
import { duplicateLayer } from "@/lib/layer-edit";
import { deleteSceneAndCloseGap } from "@/lib/scene-ripple";
import {
  layerSchema,
  timelineSchema,
  type Layer,
  type Scene,
  type Timeline,
  type Asset,
} from "@/lib/schema";
function KeyframeEditor({
  layer,
  change,
  durationFrames,
}: {
  durationFrames: number;
  layer: Layer;
  change: (l: Layer) => void;
}) {
  return (
    <details>
      <summary>Custom keyframes</summary>
      <p>
        Frame, x/y offset as a fraction of the canvas, scale, and opacity.
        Custom keys replace the motion preset.
      </p>
      <KeyframeControls
        label={`Layer ${layer.id}`}
        keys={layer.keyframes || []}
        durationFrames={durationFrames}
        onChange={(keyframes) => change({ ...layer, keyframes })}
      />
      <MotionJson
        key={JSON.stringify(layer.keyframes)}
        keys={layer.keyframes || []}
        durationFrames={durationFrames}
        onChange={(keyframes) => change({ ...layer, keyframes })}
      />
    </details>
  );
}
export function LayerEditor({
  timeline,
  selected,
  onChange,
  assets = [],
}: {
  timeline: Timeline;
  selected: number;
  onChange: (t: Timeline) => void;
  assets?: Asset[];
}) {
  const scene = timeline.scenes[selected];
  const [error, setError] = useState("");
  function update(next: Timeline) {
    const result = timelineSchema.safeParse(next);
    if (!result.success) {
      setError(result.error.issues.map((i) => i.message).join(" "));
      return;
    }
    setError("");
    onChange(result.data);
  }
  function updateScene(patch: Partial<Scene>) {
    update({
      ...timeline,
      scenes: timeline.scenes.map((s, i) =>
        i === selected ? { ...s, ...patch } : s,
      ),
    });
  }
  function updateLayer(id: string, l: Layer) {
    if (scene.layers.find((old) => old.id === id)?.locked) return;
    updateScene({
      layers: scene.layers.map((old) => (old.id === id ? l : old)),
    });
  }
  return (
    <section className="layer-editor">
      <div className="panel-heading">
        <h2>Timeline & layers · scene {selected + 1}</h2>
        <span>{scene.durationFrames} FRAMES</span>
      </div>
      <div className="layer-toolbar">
        <label>
          Canvas
          <select
            aria-label="Canvas format"
            value={timeline.format}
            onChange={(e) =>
              update({
                ...timeline,
                format: e.target.value as Timeline["format"],
              })
            }
          >
            <option value="landscape">16:9</option>
            <option value="portrait">9:16</option>
            <option value="square">1:1</option>
          </select>
        </label>
        <label>
          Scene frames
          <input
            aria-label="Scene frames"
            type="number"
            min={30}
            max={600}
            value={scene.durationFrames}
            onChange={(e) =>
              updateScene({ durationFrames: Number(e.target.value) })
            }
          />
        </label>
        <label>
          Transition
          <select
            value={scene.transition}
            onChange={(e) =>
              updateScene({ transition: e.target.value as Scene["transition"] })
            }
          >
            <option>fade</option>
            <option>cut</option>
          </select>
        </label>
        <button
          className="subtle"
          disabled={
            timeline.scenes.length >= MAX_SCENES ||
            timeline.scenes.reduce(
              (frames, scene) => frames + scene.durationFrames,
              0,
            ) +
              scene.durationFrames >
              MAX_TIMELINE_FRAMES
          }
          onClick={() =>
            update({
              ...timeline,
              scenes: [
                ...timeline.scenes.slice(0, selected + 1),
                {
                  ...structuredClone(scene),
                  id: crypto.randomUUID(),
                  title: scene.title + " copy",
                },
                ...timeline.scenes.slice(selected + 1),
              ],
            })
          }
        >
          Duplicate scene
        </button>
        <button
          className="subtle"
          disabled={timeline.scenes.length <= 1}
          aria-describedby="delete-scene-effect"
          onClick={() => {
            try {
              update(deleteSceneAndCloseGap(timeline, selected));
            } catch (problem) {
              setError(
                problem instanceof Error
                  ? problem.message
                  : "This scene could not be deleted.",
              );
            }
          }}
        >
          Delete scene and close gap
        </button>
      </div>
      <p id="delete-scene-effect">
        Deleting a scene closes its gap and moves later audio and captions
        earlier. Captions across the cut are shortened; audio across it is split
        with the existing fades shortened to fit. Undo restores the complete
        edit.
      </p>
      <CameraEditor
        key={`camera-${scene.id}`}
        scene={scene}
        onChange={(s) => updateScene(s)}
      />
      {scene.layers.map((layer) => (
        <details key={layer.id} className="layer-row">
          <summary>
            {layer.kind} · {layer.id}
          </summary>
          <fieldset className="editor-content" disabled={layer.locked}>
            <LayerRotation
              layer={layer}
              label={`Layer rotation ${layer.id}`}
              onChange={(l) => updateLayer(layer.id, l)}
            />
            {layer.kind === "text" && (
              <TypographyControls
                editContent={false}
                layer={layer}
                label={`Layer ${layer.id}`}
                onChange={(l) => updateLayer(layer.id, l)}
              />
            )}
            {layer.kind === "video" && (
              <VideoClipEditor
                layer={layer}
                asset={assets.find((a) => a.id === layer.assetId)}
                sceneFrames={scene.durationFrames}
                onChange={(l) => updateLayer(layer.id, l)}
              />
            )}
            <div className="layer-fields">
              {layer.kind === "text" && (
                <label>
                  Layer text
                  <input
                    aria-label={`Text ${layer.id}`}
                    value={layer.text}
                    maxLength={140}
                    onChange={(e) =>
                      updateLayer(layer.id, { ...layer, text: e.target.value })
                    }
                  />
                </label>
              )}
              {(["x", "y", "width", "height", "fontSize"] as const).map(
                (field) => (
                  <label key={field}>
                    {field}
                    <input
                      aria-label={`${field} ${layer.id}`}
                      type="number"
                      step={field === "fontSize" ? 1 : 0.01}
                      min={field === "fontSize" ? 12 : 0}
                      max={field === "fontSize" ? 120 : 1}
                      value={layer[field]}
                      onChange={(e) =>
                        updateLayer(layer.id, {
                          ...layer,
                          [field]: Number(e.target.value),
                        })
                      }
                    />
                  </label>
                ),
              )}
              <label>
                Color
                <input
                  type="color"
                  value={layer.color}
                  onChange={(e) =>
                    updateLayer(layer.id, { ...layer, color: e.target.value })
                  }
                />
              </label>
              <label>
                Motion
                <select
                  value={layer.animation}
                  onChange={(e) =>
                    updateLayer(layer.id, {
                      ...layer,
                      animation: e.target.value as Layer["animation"],
                      keyframes: undefined,
                    })
                  }
                >
                  {["rise", "drift", "pulse", "none"].map((a) => (
                    <option key={a}>{a}</option>
                  ))}
                </select>
              </label>
              <button
                className="subtle"
                aria-label={`Duplicate layer ${layer.id}`}
                disabled={scene.layers.length >= 20}
                onClick={() => {
                  try {
                    update(
                      duplicateLayer(timeline, selected, layer.id).timeline,
                    );
                  } catch (problem) {
                    setError(
                      problem instanceof Error
                        ? problem.message
                        : "This layer could not be duplicated.",
                    );
                  }
                }}
              >
                Duplicate layer
              </button>
              <button
                className="subtle"
                disabled={scene.layers.length === 0}
                onClick={() =>
                  updateScene({
                    layers: scene.layers.filter((l) => l.id !== layer.id),
                  })
                }
              >
                Remove layer
              </button>
            </div>
            <KeyframeEditor
              layer={layer}
              durationFrames={scene.durationFrames}
              change={(l) => updateLayer(layer.id, l)}
            />
          </fieldset>
        </details>
      ))}
      <button
        className="subtle"
        disabled={scene.layers.length >= 20}
        onClick={() =>
          updateScene({
            layers: [
              ...scene.layers,
              layerSchema.parse({
                id: crypto.randomUUID(),
                kind: "text",
                x: 0.1,
                y: 0.85,
                width: 0.8,
                height: 0.08,
                text: "Your caption",
                color: "#FFFFFF",
                fontSize: 24,
                animation: "rise",
              }),
            ],
          })
        }
      >
        Add text layer
      </button>
      <div className="layer-fields">
        {(
          [
            "circle",
            "rectangle",
            "mountain",
            "nodes",
            "character",
            "arrow",
            "gradient",
          ] as const
        ).map((kind) => (
          <button
            key={kind}
            className="subtle"
            disabled={scene.layers.length >= 20}
            onClick={() =>
              updateScene({
                layers: [
                  ...scene.layers,
                  layerSchema.parse({
                    id: crypto.randomUUID(),
                    kind,
                    x: 0.25,
                    y: 0.5,
                    width: 0.5,
                    height: 0.35,
                    color: scene.accent,
                    fontSize: 48,
                    text: "",
                    animation: "rise",
                  }),
                ],
              })
            }
          >
            Add {kind}
          </button>
        ))}
      </div>
      {error && <p role="alert">{error}</p>}
      <p>
        Changes update the preview immediately and save automatically. Undo and
        redo remain available while this project is open.
      </p>
    </section>
  );
}
