import {
  timelineSchema,
  type CreativeBrief,
  type Timeline,
  type Scene,
} from "./schema";
const palettes = [
  ["#101D31", "#D3F4A1"],
  ["#18293A", "#B6BEFF"],
  ["#162C2C", "#F7CFA0"],
];
export function mockPlan(brief: CreativeBrief): Timeline {
  const words = brief.prompt.trim().replace(/\s+/g, " ");
  const subject = words.length > 60 ? words.slice(0, 57) + "…" : words;
  const count = Math.max(3, Math.ceil(brief.duration / 20)),
    frames = Math.round(brief.duration * 30),
    per = Math.floor(frames / count);
  const strategies = ["typography", "landscape", "diagram"] as const;
  const scenes: Scene[] = Array.from({ length: count }, (_, i) => {
    const strategy = strategies[i % strategies.length];
    return {
      id: `scene-${i + 1}`,
      title: ["The opening", "A wider perspective", "Connect the dots"][i % 3],
      intent: `${subject} — ${["introduce the idea", "establish a world", "bring the idea together"][i % 3]}`,
      durationFrames: i === count - 1 ? frames - per * (count - 1) : per,
      background: palettes[i % 3][0],
      accent: palettes[i % 3][1],
      strategy,
      transition: "fade",
      layers: [
        {
          id: "eyebrow",
          kind: "text",
          x: 0.08,
          y: 0.1,
          width: 0.84,
          height: 0.07,
          text: `${String(i + 1).padStart(2, "0")} / ${strategy.toUpperCase()}`,
          color: palettes[i % 3][1],
          fontSize: 18,
          animation: "rise",
        },
        {
          id: "title",
          kind: "text",
          x: 0.08,
          y: 0.23,
          width: 0.84,
          height: 0.23,
          text:
            i % 3 === 0
              ? subject
              : i % 3 === 1
                ? "A different perspective."
                : "Everything is connected.",
          color: "#F5F5F0",
          fontSize: 52,
          animation: "rise",
        },
        {
          id: "visual",
          kind:
            strategy === "typography"
              ? "circle"
              : strategy === "landscape"
                ? "mountain"
                : "nodes",
          x: 0.15,
          y: 0.55,
          width: 0.7,
          height: 0.3,
          text: "",
          color: palettes[i % 3][1],
          fontSize: 48,
          animation: strategy === "typography" ? "pulse" : "drift",
        },
      ],
    };
  });
  return timelineSchema.parse({ fps: 30, format: brief.format, scenes });
}
