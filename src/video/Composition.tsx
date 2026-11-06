import { SoundAndCaptions } from "./SoundAndCaptions";
import React from "react";
import { textStyle } from "../lib/text-style";
import { mediaStyle } from "../lib/media-style";
import type { VideoCompositePass } from "../lib/video-composite-plan";
import {
  AbsoluteFill,
  Sequence,
  useCurrentFrame,
  OffthreadVideo,
  Img,
} from "remotion";
import {
  layerMotion,
  keyframeMotion,
  formats,
  videoDimensions,
  type Timeline,
  type Scene,
} from "../lib/schema";
function SceneView({
  scene,
  format,
  exportResolution,
  assetSources,
  layoutOnly = false,
  compositePass,
}: {
  scene: Scene;
  format: Timeline["format"];
  exportResolution?: Timeline["exportResolution"];
  assetSources: Record<string, string>;
  layoutOnly?: boolean;
  compositePass?: VideoCompositePass;
}) {
  const currentFrame = useCurrentFrame();
  const frame = layoutOnly ? 0 : currentFrame;
  const motionFrame = frame + (scene.motionOffsetFrames || 0);
  const { width, height } = videoDimensions({ format, exportResolution });
  const pixelScale = width / formats[format].width;
  const camera = keyframeMotion(layoutOnly ? [] : scene.camera || [], frame);
  const opacity =
    !layoutOnly && scene.transition === "fade"
      ? Math.min(
          1,
          scene.fadeIn === false ? 1 : frame / 10,
          scene.fadeOut === false ? 1 : (scene.durationFrames - frame) / 10,
        )
      : 1;
  const videoIndex = compositePass
    ? scene.layers.findIndex((layer) => layer.id === compositePass.videoLayerId)
    : -1;
  if (compositePass && videoIndex < 0)
    throw new Error("Invalid compositing pass.");
  const layers = !compositePass
    ? scene.layers
    : compositePass.part === "under"
      ? scene.layers.slice(0, videoIndex)
      : scene.layers.slice(videoIndex + 1);
  const transparent = compositePass?.part === "over";
  return (
    <AbsoluteFill
      style={{
        background: transparent ? "transparent" : scene.background,
        overflow: "hidden",
        fontFamily: "Arial, sans-serif",
      }}
    >
      <AbsoluteFill
        style={{
          opacity: opacity * camera.opacity,
          transform: `translate(${camera.x * width}px, ${camera.y * height}px) rotate(${camera.rotation}deg) scale(${camera.scale})`,
        }}
      >
        {!transparent && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              background: `radial-gradient(ellipse at 85% 10%, ${scene.accent}22, transparent 60%)`,
            }}
          />
        )}
        {layers
          .filter((l) => !l.hidden)
          .map((l) => {
            const a = layoutOnly
              ? keyframeMotion([], 0)
              : layerMotion(l, l.keyframes?.length ? frame : motionFrame);
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
                  transform: `translate(${a.x * width}px, ${a.y * height + a.translateY * pixelScale}px) rotate(${(l.rotation || 0) + a.rotation}deg) scale(${a.scale})`,
                  overflow: "hidden",
                  display: "flex",
                  alignItems: "center",
                  ...(l.mask === "circle"
                    ? { clipPath: "ellipse(50% 50% at 50% 50%)" }
                    : l.mask === "rounded"
                      ? {
                          clipPath: `inset(0 round ${Math.round(Math.min(l.width * width, l.height * height) * 0.12)}px)`,
                        }
                      : {}),
                }}
              >
                {l.kind === "video" && l.video ? (
                  <Sequence
                    layout="none"
                    from={layoutOnly ? 0 : l.video.startFrame}
                    durationInFrames={layoutOnly ? 1 : l.video.durationFrames}
                  >
                    <OffthreadVideo
                      src={assetSources[l.assetId || ""]}
                      trimBefore={l.video.offsetFrames}
                      muted
                      style={mediaStyle(l)}
                    />
                  </Sequence>
                ) : l.kind === "character" ? (
                  <svg width="100%" height="100%" viewBox="0 0 200 300">
                    <g
                      transform={`rotate(${Math.sin(motionFrame / 18) * 3},100,160)`}
                    >
                      <path
                        d="M80 220L70 285M120 220L130 285"
                        stroke={l.color}
                        strokeWidth="18"
                        strokeLinecap="round"
                      />
                      <path
                        d="M55 140L25 205M145 140L175 205"
                        stroke={l.color}
                        strokeWidth="16"
                        strokeLinecap="round"
                      />
                      <rect
                        x="55"
                        y="115"
                        width="90"
                        height="120"
                        rx="30"
                        fill={l.color}
                      />
                      <circle cx="100" cy="65" r="45" fill={l.color} />
                      <circle cx="85" cy="62" r="5" fill="#101D31" />
                      <circle cx="115" cy="62" r="5" fill="#101D31" />
                      <path
                        d="M85 82Q100 95 115 82"
                        stroke="#101D31"
                        strokeWidth="4"
                        fill="none"
                      />
                    </g>
                  </svg>
                ) : l.kind === "arrow" ? (
                  <svg width="100%" height="100%" viewBox="0 0 400 160">
                    <path
                      d="M20 80H300"
                      stroke={l.color}
                      strokeWidth="16"
                      strokeLinecap="round"
                    />
                    <path
                      d="M285 25L350 80L285 135"
                      stroke={l.color}
                      strokeWidth="16"
                      fill="none"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                ) : l.kind === "gradient" ? (
                  <div
                    style={{
                      width: "100%",
                      height: "100%",
                      background: `linear-gradient(135deg,${l.color},${scene.accent})`,
                      borderRadius: 20 * pixelScale,
                    }}
                  />
                ) : l.kind === "image" ? (
                  <Img
                    alt=""
                    src={assetSources[l.assetId || ""]}
                    style={mediaStyle(l)}
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
                      cx={400 + Math.cos(motionFrame / 35) * 180}
                      cy={110 + Math.sin(motionFrame / 35) * 85}
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
                        r={18 + Math.sin(motionFrame / 20 + i) * 4}
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
                      borderRadius: 16 * pixelScale,
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
export function SceneLayout(props: {
  scene: Scene;
  format: Timeline["format"];
  exportResolution?: Timeline["exportResolution"];
  assetSources: Record<string, string>;
}) {
  return <SceneView {...props} layoutOnly />;
}
export function Film({
  timeline,
  assetSources = {},
  compositePass,
}: {
  timeline: Timeline;
  assetSources?: Record<string, string>;
  compositePass?: VideoCompositePass;
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
              exportResolution={timeline.exportResolution}
              assetSources={assetSources}
              compositePass={compositePass}
            />
          </Sequence>
        );
      })}
      {compositePass?.part !== "under" && (
        <SoundAndCaptions timeline={timeline} assetSources={assetSources} />
      )}
    </AbsoluteFill>
  );
}
