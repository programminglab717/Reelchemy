"use client";
import { useState } from "react";
import {
  layerSchema,
  timelineSchema,
  type Layer,
  type Scene,
  type Timeline,
} from "@/lib/schema";
function KeyframeEditor({
  layer,
  change,
}: {
  layer: Layer;
  change: (l: Layer) => void;
}) {
  const [draft, setDraft] = useState(
      JSON.stringify(layer.keyframes || [], null, 2),
    ),
    [error, setError] = useState("");
  return (
    <details>
      <summary>Custom keyframes</summary>
      <p>
        Frame, x/y offset as a fraction of the canvas, scale, and opacity.
        Custom keys replace the motion preset.
      </p>
      <textarea
        aria-label="Keyframe JSON"
        rows={6}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
      />
      <button
        className="subtle"
        onClick={() => {
          try {
            const next = layerSchema.parse({
              ...layer,
              keyframes: JSON.parse(draft),
            });
            change(next);
            setError("");
          } catch {
            setError(
              "Enter a valid keyframe array. Frames must increase and fit this scene.",
            );
          }
        }}
      >
        Apply keyframes
      </button>
      {error && <p role="alert">{error}</p>}
    </details>
  );
}
export function LayerEditor({
  timeline,
  selected,
  onChange,
}: {
  timeline: Timeline;
  selected: number;
  onChange: (t: Timeline) => void;
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
          disabled={timeline.scenes.length >= 12}
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
          onClick={() =>
            update({
              ...timeline,
              scenes: timeline.scenes.filter((_, i) => i !== selected),
            })
          }
        >
          Delete scene
        </button>
      </div>
      {scene.layers.map((layer) => (
        <details key={layer.id} className="layer-row">
          <summary>
            {layer.kind} · {layer.id}
          </summary>
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
              disabled={scene.layers.length <= 1}
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
            key={JSON.stringify(layer.keyframes)}
            layer={layer}
            change={(l) => updateLayer(layer.id, l)}
          />
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
      {error && <p role="alert">{error}</p>}
      <p>
        Changes update the preview immediately. Save changes above before
        leaving this project.
      </p>
    </section>
  );
}
