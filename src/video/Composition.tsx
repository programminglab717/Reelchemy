import React from "react";
import { textStyle } from "../lib/text-style";
import { AbsoluteFill, Sequence, useCurrentFrame } from "remotion";
import { layerMotion, formats, type Timeline, type Scene } from "../lib/schema";
function SceneView({
  scene,
  format,
  assetSources,
}: {
  scene: Scene;
  format: Timeline["format"];
  assetSources: Record<string, string>;
}) {
  const frame = useCurrentFrame();
  const { width, height } = formats[format];
  const opacity =
    scene.transition === "fade"
      ? Math.min(1, frame / 10, (scene.durationFrames - frame) / 10)
      : 1;
  return (
    <AbsoluteFill
      style={{
        background: scene.background,
        overflow: "hidden",
        fontFamily: "Arial, sans-serif",
      }}
    >
      <AbsoluteFill style={{ opacity }}>
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: `radial-gradient(ellipse at 85% 10%, ${scene.accent}22, transparent 60%)`,
          }}
        />
        {scene.layers.map((l) => {
          const a = layerMotion(l, frame);
          return (
            <div
              key={l.id}
              style={{
                position: "absolute",
                left: `${l.x * 100}%`,
                top: `${l.y * 100}%`,
                width: `${l.width * 100}%`,
                height: `${l.height * 100}%`,
                color: l.color,
                opacity: a.opacity,
                transform: `translate(${a.x * width}px, ${a.y * height + a.translateY}px) scale(${a.scale})`,
                overflow: "hidden",
                display: "flex",
                alignItems: "center",
              }}
            >
              {l.kind === "image" ? (
                <img
                  alt=""
                  src={assetSources[l.assetId || ""]}
                  style={{
                    width: "100%",
                    height: "100%",
                    objectFit: "contain",
                  }}
                />
              ) : l.kind === "text" ? (
                <div style={textStyle(l, width)}>{l.text}</div>
              ) : l.kind === "circle" ? (
                <svg width="100%" height="100%" viewBox="0 0 800 220">
                  <ellipse
                    cx="400"
                    cy="110"
                    rx="310"
                    ry="92"
                    fill="none"
                    stroke={l.color}
                    strokeWidth="2"
                  />
                  <ellipse
                    cx="400"
                    cy="110"
                    rx="180"
                    ry="92"
                    fill="none"
                    stroke={l.color}
                    strokeWidth="2"
                  />
                  <circle
                    cx={400 + Math.cos(frame / 35) * 180}
                    cy={110 + Math.sin(frame / 35) * 85}
                    r="15"
                    fill={l.color}
                  />
                  <circle cx="400" cy="110" r="42" fill={l.color} />
                </svg>
              ) : l.kind === "mountain" ? (
                <svg
                  width="100%"
                  height="100%"
                  viewBox="0 0 800 240"
                  preserveAspectRatio="none"
                >
                  <circle cx="610" cy="45" r="32" fill={l.color} />
                  <path
                    d="M0 240L180 30L360 240L510 80L800 240Z"
                    fill={l.color}
                    opacity=".3"
                  />
                  <path
                    d="M0 240L300 70L480 240L650 130L800 240Z"
                    fill={l.color}
                    opacity=".7"
                  />
                </svg>
              ) : l.kind === "nodes" ? (
                <svg width="100%" height="100%" viewBox="0 0 800 220">
                  <path
                    d="M100 110L400 45L700 110L400 180Z M100 110H700 M400 45V180"
                    fill="none"
                    stroke={l.color}
                    strokeWidth="2"
                  />
                  {[
                    [100, 110],
                    [400, 45],
                    [700, 110],
                    [400, 180],
                  ].map(([x, y], i) => (
                    <circle
                      key={i}
                      cx={x}
                      cy={y}
                      r={18 + Math.sin(frame / 20 + i) * 4}
                      fill={l.color}
                    />
                  ))}
                </svg>
              ) : (
                <div
                  style={{
                    background: l.color,
                    width: "100%",
                    height: "100%",
                    borderRadius: 16,
                  }}
                />
              )}
            </div>
          );
        })}
      </AbsoluteFill>
    </AbsoluteFill>
  );
}
export function Film({
  timeline,
  assetSources = {},
}: {
  timeline: Timeline;
  assetSources?: Record<string, string>;
}) {
  return (
    <AbsoluteFill>
      {timeline.scenes.map((scene, index) => {
        const start = timeline.scenes
          .slice(0, index)
          .reduce((sum, prior) => sum + prior.durationFrames, 0);
        return (
          <Sequence
            key={scene.id}
            from={start}
            durationInFrames={scene.durationFrames}
          >
            <SceneView
              scene={scene}
              format={timeline.format}
              assetSources={assetSources}
            />
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
}
