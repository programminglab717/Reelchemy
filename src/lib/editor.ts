import {
  timelineSchema,
  type Project,
  type Timeline,
  type CreativeBrief,
} from "./schema";

export const revisionId = (p: Project) => p.revisions.at(-1)?.id ?? null;
export class RevisionConflict extends Error {
  constructor() {
    super(
      "This project has a newer saved version. Your edits are kept here; download your draft before opening the latest version.",
    );
  }
}
export type EditHistory = {
  past: Timeline[];
  present: Timeline;
  future: Timeline[];
};
export function editHistory(
  state: EditHistory,
  action: Timeline | "undo" | "redo",
): EditHistory {
  if (action === "undo") {
    if (!state.past.length) return state;
    return {
      past: state.past.slice(0, -1),
      present: state.past.at(-1)!,
      future: [state.present, ...state.future].slice(0, 50),
    };
  }
  if (action === "redo") {
    if (!state.future.length) return state;
    return {
      past: [...state.past, state.present].slice(-50),
      present: state.future[0],
      future: state.future.slice(1),
    };
  }
  const next = timelineSchema.parse(action);
  if (JSON.stringify(next) === JSON.stringify(state.present)) return state;
  return {
    past: [...state.past, state.present].slice(-50),
    present: next,
    future: [],
  };
}
export function blankTimeline(brief: CreativeBrief): Timeline {
  const count = Math.ceil(brief.duration / 20);
  const frames = brief.duration * 30;
  return timelineSchema.parse({
    fps: 30,
    format: brief.format,
    scenes: Array.from({ length: count }, (_, i) => ({
      id: crypto.randomUUID(),
      title: `Scene ${i + 1}`,
      intent: "Manual composition",
      durationFrames: Math.floor(frames / count) + (i < frames % count ? 1 : 0),
      background: "#101D31",
      accent: "#D5F281",
      strategy: "typography",
      transition: "cut",
      layers: [
        {
          id: "title",
          kind: "text",
          x: 0.1,
          y: 0.35,
          width: 0.8,
          height: 0.3,
          text: "Your story starts here",
          color: "#FFFFFF",
          fontSize: 56,
          animation: "none",
        },
      ],
    })),
  });
}
