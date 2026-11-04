import React from "react";
import { Composition, registerRoot } from "remotion";
import { Film } from "./Composition";
import { mockPlan } from "../lib/demo-plan";
import { videoDimensions, totalFrames, type Timeline } from "../lib/schema";
const timeline = mockPlan({
  prompt: "Ideas become motion.",
  duration: 5,
  format: "landscape",
});
const Root = () => (
  <Composition
    id="Reelchemy"
    component={Film}
    durationInFrames={150}
    fps={30}
    width={1280}
    height={720}
    defaultProps={{ timeline }}
    calculateMetadata={({ props }: { props: { timeline: Timeline } }) => ({
      ...videoDimensions(props.timeline),
      fps: 30,
      durationInFrames: totalFrames(props.timeline),
    })}
  />
);
registerRoot(Root);
