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
  context?: { current: Timeline; instruction: string },
): Promise<{ timeline: Timeline; provider: string }> {
  const provider = process.env.AI_PROVIDER || "mock";
  if (provider === "mock")
    return { timeline: mockPlan(brief), provider: "mock" };
  if (!["compatible", "anthropic"].includes(provider))
    throw new Error(
      "Unknown AI_PROVIDER. Choose mock, compatible, or anthropic.",
    );
  const { AI_API_KEY, AI_MODEL } = process.env;
  const AI_BASE_URL =
    process.env.AI_BASE_URL ||
    (provider === "anthropic" ? "https://api.anthropic.com/v1" : undefined);
  if (!AI_BASE_URL || !AI_API_KEY || !AI_MODEL)
    throw new Error(
      "Compatible provider requires AI_BASE_URL, AI_API_KEY, and AI_MODEL on the server.",
    );
  const url = new URL(AI_BASE_URL);
  if (url.protocol !== "https:") throw new Error("AI_BASE_URL must use HTTPS.");
  const res = await fetch(
    `${url.toString().replace(/\/$/, "")}/${provider === "anthropic" ? "messages" : "chat/completions"}`,
    {
      method: "POST",
      headers: {
        ...(provider === "anthropic"
          ? { "x-api-key": AI_API_KEY, "anthropic-version": "2023-06-01" }
          : { Authorization: `Bearer ${AI_API_KEY}` }),
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(60000),
      body: JSON.stringify(providerPayload(provider, AI_MODEL, brief, context)),
    },
  );
  if (!res.ok)
    throw new Error(
      `AI provider returned HTTP ${res.status}. Check server configuration.`,
    );
  const data = await res.json();
  const timeline = timelineSchema.parse(
    JSON.parse(
      provider === "anthropic"
        ? (data.content || [])
            .filter((b: { type: string }) => b.type === "text")
            .map((b: { text: string }) => b.text)
            .join("")
        : data.choices?.[0]?.message?.content || "",
    ),
  );
  if (
    timeline.scenes.reduce((n, s) => n + s.durationFrames, 0) !==
    Math.round(brief.duration * 30)
  )
    throw new Error(
      "Provider returned a duration different from the requested brief.",
    );
  return { timeline, provider };
}

function providerPayload(
  provider: string,
  model: string,
  brief: CreativeBrief,
  context?: { current: Timeline; instruction: string },
) {
  const system = `You are a video director. Return ONLY a JSON timeline matching this JSON Schema: ${JSON.stringify(z.toJSONSchema(timelineSchema, { io: "input" }))}. Coordinates and dimensions are fractions. Keep text separated and inside bounds. No external assets or executable code. FPS=30; duration must match the brief. When revising, preserve IDs and scene timing. Respond with JSON only, without markdown.`;
  const content = JSON.stringify({ brief, ...context });
  return provider === "anthropic"
    ? { model, max_tokens: 6000, system, messages: [{ role: "user", content }] }
    : {
        model,
        max_tokens: 6000,
        temperature: 0.4,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: system },
          { role: "user", content },
        ],
      };
}
export async function reviseScene(
  current: Timeline,
  sceneId: string,
  instruction: string,
) {
  const index = current.scenes.findIndex((s) => s.id === sceneId);
  if (index < 0) throw new Error("Scene not found.");
  const source = current.scenes[index];
  let replacement: Scene;
  if ((process.env.AI_PROVIDER || "mock") === "mock") {
    replacement = structuredClone(source);
    replacement.intent = instruction;
    replacement.layers = replacement.layers.map((l) =>
      l.kind === "text" && l.id === "title"
        ? { ...l, text: instruction.slice(0, 140) }
        : l,
    );
  } else {
    const result = await generatePlan(
      {
        prompt: source.intent,
        duration: source.durationFrames / 30,
        format: current.format,
      },
      { current: { ...current, scenes: [source] }, instruction },
    );
    if (result.timeline.scenes.length !== 1)
      throw new Error("Scene revision must return exactly one scene.");
    replacement = result.timeline.scenes[0];
    if (
      replacement.id !== source.id ||
      replacement.durationFrames !== source.durationFrames
    )
      throw new Error("Scene revision changed its ID or duration.");
  }
  return timelineSchema.parse({
    ...current,
    scenes: current.scenes.map((s, i) => (i === index ? replacement : s)),
  });
}
