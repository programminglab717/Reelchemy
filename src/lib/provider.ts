import { z } from "zod";
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
  const count = 3,
    frames = Math.round(brief.duration * 30),
    per = Math.floor(frames / count);
  const strategies = ["typography", "landscape", "diagram"] as const;
  const scenes: Scene[] = strategies.map((strategy, i) => ({
    id: `scene-${i + 1}`,
    title: ["The opening", "A wider perspective", "Connect the dots"][i],
    intent: `${subject} — ${["introduce the idea", "establish a world", "bring the idea together"][i]}`,
    durationFrames: i === 2 ? frames - per * 2 : per,
    background: palettes[i][0],
    accent: palettes[i][1],
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
        color: palettes[i][1],
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
          i === 0
            ? subject
            : i === 1
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
        color: palettes[i][1],
        fontSize: 48,
        animation: strategy === "typography" ? "pulse" : "drift",
      },
    ],
  }));
  return timelineSchema.parse({ fps: 30, format: brief.format, scenes });
}
export async function generatePlan(
  brief: CreativeBrief,
): Promise<{ timeline: Timeline; provider: string }> {
  const provider = process.env.AI_PROVIDER || "mock";
  if (provider === "mock")
    return { timeline: mockPlan(brief), provider: "mock" };
  if (provider !== "compatible")
    throw new Error("Unknown AI_PROVIDER. Choose mock or compatible.");
  const { AI_BASE_URL, AI_API_KEY, AI_MODEL } = process.env;
  if (!AI_BASE_URL || !AI_API_KEY || !AI_MODEL)
    throw new Error(
      "Compatible provider requires AI_BASE_URL, AI_API_KEY, and AI_MODEL on the server.",
    );
  const url = new URL(AI_BASE_URL);
  if (url.protocol !== "https:") throw new Error("AI_BASE_URL must use HTTPS.");
  const res = await fetch(
    `${url.toString().replace(/\/$/, "")}/chat/completions`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${AI_API_KEY}`,
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(60000),
      body: JSON.stringify({
        model: AI_MODEL,
        max_tokens: 6000,
        temperature: 0.4,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: `You are a video director. Return ONLY a JSON timeline matching this JSON Schema: ${JSON.stringify(z.toJSONSchema(timelineSchema, { io: "input" }))}. Coordinates and dimensions are fractions of frame; keep layers inside bounds and text separated. Use only these scene primitives; no external assets. fps=30. Duration must match the brief. Scene strategies may vary.`,
          },
          { role: "user", content: JSON.stringify(brief) },
        ],
      }),
    },
  );
  if (!res.ok)
    throw new Error(
      `AI provider returned HTTP ${res.status}. Check server configuration.`,
    );
  const data = await res.json();
  const timeline = timelineSchema.parse(
    JSON.parse(data.choices?.[0]?.message?.content || ""),
  );
  if (
    timeline.scenes.reduce((n, s) => n + s.durationFrames, 0) !==
    Math.round(brief.duration * 30)
  )
    throw new Error(
      "Provider returned a duration different from the requested brief.",
    );
  return { timeline, provider: "compatible" };
}
