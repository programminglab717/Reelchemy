"use client";
import { useRef, useState, type PointerEvent } from "react";
import { Player } from "@remotion/player";
import { SceneLayout } from "@/video/Composition";
import { videoDimensions, type Timeline, type Layer } from "@/lib/schema";
import { placeLayer } from "@/lib/canvas";
import { TypographyControls } from "./TypographyControls";
import { MediaFitControls } from "./MediaFitControls";
import { layerCorners } from "@/lib/layer-geometry";
import { LayerRotation } from "./LayerRotation";
import { duplicateLayer } from "@/lib/layer-edit";
import { previewMotionBaseUrl } from "@/motion/preview";
import { fitLayersToFrame } from "@/lib/frame-fit";

export function CanvasEditor({
  timeline,
  selected,
  assetSources,
  onChange,
  fonts = [],
}: {
  timeline: Timeline;
  selected: number;
  assetSources: Record<string, string>;
  onChange: (t: Timeline) => void;
  fonts?: { id: string; name: string }[];
}) {
  const scene = timeline.scenes[selected];
  const [selectedId, setSelectedId] = useState(scene.layers[0]?.id);
  const [draft, setDraft] = useState<Layer | null>(null);
  const [snap, setSnap] = useState(true);
  const [layerError, setLayerError] = useState("");
  const stage = useRef<HTMLDivElement>(null);
  const gesture = useRef<{
    layer: Layer;
    x: number;
    y: number;
    width: number;
    height: number;
    resize: boolean;
    snap: boolean;
  } | null>(null);
  const layer =
    scene.layers.find((l) => l.id === selectedId) || scene.layers[0];
  const activeId = layer?.id;
  const dimensions = videoDimensions(timeline);
  function update(l: Layer) {
    onChange({
      ...timeline,
      scenes: timeline.scenes.map((s, i) =>
        i === selected
          ? { ...s, layers: s.layers.map((old) => (old.id === l.id ? l : old)) }
          : s,
      ),
    });
  }
  function begin(
    e: PointerEvent<HTMLButtonElement>,
    l: Layer,
    resize: boolean,
  ) {
    if (e.button !== 0 || e.currentTarget.disabled) return;
    e.preventDefault();
    e.currentTarget.focus();
    setSelectedId(l.id);
    if (l.locked) return;
    const bounds = stage.current!.getBoundingClientRect();
    gesture.current = {
      layer: l,
      x: e.clientX,
      y: e.clientY,
      width: bounds.width,
      height: bounds.height,
      resize,
      snap,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  }
  function position(e: PointerEvent<HTMLButtonElement>) {
    const g = gesture.current;
    return g
      ? placeLayer(
          g.layer,
          (e.clientX - g.x) / g.width,
          (e.clientY - g.y) / g.height,
          g.resize,
          g.snap && !e.altKey,
          dimensions,
        )
      : null;
  }
  function finish(e: PointerEvent<HTMLButtonElement>) {
    const next = position(e),
      g = gesture.current;
    gesture.current = null;
    setDraft(null);
    if (e.currentTarget.hasPointerCapture(e.pointerId))
      e.currentTarget.releasePointerCapture(e.pointerId);
    // A keyboard undo during a gesture must not be overwritten by pointer release.
    if (next && g && scene.layers.find((l) => l.id === next.id) === g.layer)
      update(next);
  }
  const visible = draft
    ? {
        ...scene,
        layers: scene.layers.map((l) => (l.id === draft.id ? draft : l)),
      }
    : scene;
  return (
    <section
      id="studio-tool-canvas"
      tabIndex={-1}
      className="canvas-editor layer-editor"
    >
      <div className="panel-heading">
        <h2>Arrange scene {selected + 1}</h2>
        <label>
          <input
            type="checkbox"
            checked={snap}
            onChange={(e) => setSnap(e.target.checked)}
          />{" "}
          Snap to canvas
        </label>
      </div>
      {(() => {
        // Layers past the frame's edge (or text likely cut off by its box).
        const fitted = fitLayersToFrame({
          ...timeline,
          scenes: [scene],
        }).scenes[0].layers.map((layer, i) =>
          scene.layers[i].locked ? scene.layers[i] : layer,
        );
        if (JSON.stringify(fitted) === JSON.stringify(scene.layers))
          return null;
        return (
          <div className="frame-fit-notice" role="status">
            <span>
              Some layers extend past the video frame, or their text may be cut
              off by its box.
            </span>
            <button
              type="button"
              className="subtle"
              onClick={() =>
                onChange({
                  ...timeline,
                  scenes: timeline.scenes.map((s, i) =>
                    i === selected ? { ...s, layers: fitted } : s,
                  ),
                })
              }
            >
              Fit to frame
            </button>
          </div>
        );
      })()}
      <p>
        Drag to place a layer; use its corner to resize. Arrow keys move by one
        pixel, Shift by ten. Hold Alt to bypass snapping. Motion and camera
        playback appear in Live preview.
      </p>
      <div className="canvas-grid">
        <div
          className="canvas-stage"
          ref={stage}
          style={{ aspectRatio: `${dimensions.width}/${dimensions.height}` }}
        >
          <div className="layout-render">
            <Player
              component={SceneLayout}
              inputProps={{
                scene: visible,
                motionBaseUrl: previewMotionBaseUrl(),
                format: timeline.format,
                exportResolution: timeline.exportResolution,
                assetSources,
              }}
              durationInFrames={1}
              fps={30}
              compositionWidth={dimensions.width}
              compositionHeight={dimensions.height}
              style={{ width: "100%", height: "100%" }}
              controls={false}
              clickToPlay={false}
            />
          </div>
          <div className="canvas-guides" aria-hidden="true" />
          {visible.layers
            .filter((l) => !l.hidden)
            .map((l) => (
              <button
                key={l.id}
                type="button"
                aria-label={`Select layer ${l.id}`}
                aria-pressed={activeId === l.id}
                className={`canvas-layer ${activeId === l.id ? "selected" : ""} ${l.locked ? "locked" : ""}`}
                style={{
                  left: `${l.x * 100}%`,
                  top: `${l.y * 100}%`,
                  width: `${l.width * 100}%`,
                  height: `${l.height * 100}%`,
                  transform: `rotate(${l.rotation || 0}deg)`,
                }}
                onClick={() => setSelectedId(l.id)}
                onFocus={() => setSelectedId(l.id)}
                onPointerDown={(e) => begin(e, l, false)}
                onPointerMove={(e) => {
                  const next = position(e);
                  if (next) setDraft(next);
                }}
                onPointerUp={finish}
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
                  const directions: Record<string, [number, number]> = {
                    ArrowLeft: [-1, 0],
                    ArrowRight: [1, 0],
                    ArrowUp: [0, -1],
                    ArrowDown: [0, 1],
                  };
                  const d = directions[e.key];
                  if (!d) return;
                  e.preventDefault();
                  e.stopPropagation();
                  const step = e.shiftKey ? 10 : 1;
                  update(
                    placeLayer(
                      l,
                      (d[0] * step) / dimensions.width,
                      (d[1] * step) / dimensions.height,
                      false,
                      false,
                      dimensions,
                    ),
                  );
                }}
              />
            ))}
          {layer && !layer.hidden && !layer.locked && (
            <button
              aria-label={`Resize layer ${layer.id}`}
              className="canvas-resize"
              style={{
                left: `${layerCorners(draft || layer, dimensions)[2].x * 100}%`,
                top: `${layerCorners(draft || layer, dimensions)[2].y * 100}%`,
              }}
              onPointerDown={(e) => begin(e, layer, true)}
              onPointerMove={(e) => {
                const next = position(e);
                if (next) setDraft(next);
              }}
              onPointerUp={finish}
              onPointerCancel={() => {
                gesture.current = null;
                setDraft(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  gesture.current = null;
                  setDraft(null);
                }
              }}
            />
          )}
        </div>
        <div className="canvas-stack" aria-label="Layer stack">
          <h3>Layers · front to back</h3>
          {[...scene.layers].reverse().map((l) => (
            <div key={l.id} className={activeId === l.id ? "chosen-layer" : ""}>
              <button
                className="layer-select"
                aria-label={`Choose ${l.id} in layer stack`}
                aria-pressed={activeId === l.id}
                onClick={() => setSelectedId(l.id)}
              >
                {l.kind === "text" ? l.text || "Empty text" : l.kind}
              </button>
              <button
                aria-label={`${l.hidden ? "Show" : "Hide"} layer ${l.id}`}
                onClick={() => update({ ...l, hidden: !l.hidden })}
              >
                {l.hidden ? "Show" : "Hide"}
              </button>
              <button
                aria-label={`${l.locked ? "Unlock" : "Lock"} layer ${l.id}`}
                onClick={() => update({ ...l, locked: !l.locked })}
              >
                {l.locked ? "Unlock" : "Lock"}
              </button>
            </div>
          ))}
          {layer && (
            <div className="canvas-inspector">
              <strong>
                {layer.kind} · {layer.id}
              </strong>
              <fieldset className="editor-content" disabled={layer.locked}>
                <LayerRotation
                  key={layer.id}
                  layer={layer}
                  label={`Canvas rotation ${layer.id}`}
                  onChange={update}
                  onPreview={setDraft}
                />
              </fieldset>
              {(layer.kind === "image" || layer.kind === "video") && (
                <fieldset className="editor-content" disabled={layer.locked}>
                  <MediaFitControls
                    key={layer.id}
                    layer={layer}
                    onChange={update}
                    onPreview={setDraft}
                  />
                </fieldset>
              )}
              {layer.kind === "text" && (
                <fieldset className="editor-content" disabled={layer.locked}>
                  <TypographyControls
                    layer={layer}
                    label={`Canvas ${layer.id}`}
                    onChange={update}
                    fonts={fonts}
                  />
                </fieldset>
              )}
              <div className="layer-fields">
                <button
                  className="subtle"
                  aria-label="Duplicate selected layer"
                  disabled={
                    layer.locked || scene.layers.length >= 20 || !!draft
                  }
                  onClick={() => {
                    if (gesture.current) return;
                    try {
                      const copied = duplicateLayer(
                        timeline,
                        selected,
                        layer.id,
                      );
                      onChange(copied.timeline);
                      setSelectedId(copied.layerId);
                      setLayerError("");
                    } catch (error) {
                      setLayerError(
                        error instanceof Error
                          ? error.message
                          : "This layer could not be duplicated.",
                      );
                    }
                  }}
                >
                  Duplicate layer
                </button>
                <button
                  className="subtle"
                  disabled={
                    layer.locked ||
                    scene.layers.indexOf(layer) === scene.layers.length - 1
                  }
                  onClick={() => {
                    const layers = [...scene.layers],
                      i = layers.indexOf(layer);
                    [layers[i], layers[i + 1]] = [layers[i + 1], layers[i]];
                    onChange({
                      ...timeline,
                      scenes: timeline.scenes.map((s, j) =>
                        j === selected ? { ...s, layers } : s,
                      ),
                    });
                  }}
                >
                  Bring forward
                </button>
                <button
                  className="subtle"
                  disabled={layer.locked || scene.layers.indexOf(layer) === 0}
                  onClick={() => {
                    const layers = [...scene.layers],
                      i = layers.indexOf(layer);
                    [layers[i], layers[i - 1]] = [layers[i - 1], layers[i]];
                    onChange({
                      ...timeline,
                      scenes: timeline.scenes.map((s, j) =>
                        j === selected ? { ...s, layers } : s,
                      ),
                    });
                  }}
                >
                  Send backward
                </button>
                <button
                  className="subtle"
                  disabled={layer.locked}
                  onClick={() =>
                    update({ ...layer, x: Math.max(0, (1 - layer.width) / 2) })
                  }
                >
                  Center horizontally
                </button>
                <button
                  className="subtle"
                  disabled={layer.locked}
                  onClick={() =>
                    update({ ...layer, y: Math.max(0, (1 - layer.height) / 2) })
                  }
                >
                  Center vertically
                </button>
              </div>
              {layerError && (
                <p role="alert" aria-label="Layer action error">
                  {layerError}
                </p>
              )}
              <small>
                Duplication keeps position, motion, styling and the original
                media.
              </small>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
