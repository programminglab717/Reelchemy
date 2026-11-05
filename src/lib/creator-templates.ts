import { sceneNoteCues } from "./scene-notes";
import {
  timelineSchema,
  type Timeline,
  type Scene,
  type Layer,
} from "./schema";

export const creatorTemplateIds = [
  "vertical-launch",
  "clear-explainer",
  "brand-story",
] as const;
export type CreatorTemplateId = (typeof creatorTemplateIds)[number];
export const creatorTemplates = [
  {
    id: "vertical-launch",
    name: "A clear launch",
    duration: 45,
    format: "portrait",
    summary: "A three-part vertical promotion: hook, benefit and next step.",
  },
  {
    id: "clear-explainer",
    name: "From idea to story",
    duration: 180,
    format: "landscape",
    summary:
      "A three-minute explainer with nine scenes and a complete narration outline.",
  },
  {
    id: "brand-story",
    name: "Make something that matters",
    duration: 60,
    format: "landscape",
    summary:
      "A one-minute story about your purpose, process, proof and invitation.",
  },
] as const;
export function creatorTemplate(id: CreatorTemplateId) {
  const selected = creatorTemplates.find((template) => template.id === id);
  if (!selected) throw new Error("Unknown starter template.");
  return selected;
}

type Outline = {
  title: string;
  body: string;
  notes: string;
  steps: [string, string, string];
};
const launch: Outline[] = [
  {
    title: "Less noise.\nMore focus.",
    body: "Make room for the work that matters.",
    notes:
      "Most days are full of things asking for our attention. The important work can get lost between them. Start by making a little room: one idea, one task, one thing that deserves your best energy.",
    steps: ["Pause", "Choose", "Begin"],
  },
  {
    title: "One clear\nnext step.",
    body: "Turn a good intention into something you can do today.",
    notes:
      "You do not need to solve everything at once. Choose a next step small enough to begin and meaningful enough to move you forward. Give it your attention, make something tangible, and let that progress guide the next decision.",
    steps: ["Choose focus", "Make progress", "Keep going"],
  },
  {
    title: "Your next chapter\nstarts today.",
    body: "Make time for your best work.",
    notes:
      "A better way of working begins with a small change you can repeat. Make room for what matters, follow through on one clear next step, and build from there. Your next chapter starts with what you choose to do today.",
    steps: ["Start small", "Find a rhythm", "Share the work"],
  },
];
const explainer: Outline[] = [
  {
    title: "Start with one idea",
    body: "A useful story begins with something worth saying.",
    notes:
      "Before you choose images or open a timeline, decide what your story is really about. Write it in one sentence. A clear central idea gives every later choice a purpose and helps your audience understand why this film deserves their attention.",
    steps: ["Notice", "Question", "Choose"],
  },
  {
    title: "Know who it is for",
    body: "Make the story useful to a particular person.",
    notes:
      "Imagine one person watching your film. What do they already know, and what are they trying to understand? Their questions help you decide what to explain, which examples to show, and what you can leave out without losing the point.",
    steps: ["Audience", "Question", "Context"],
  },
  {
    title: "Give it a purpose",
    body: "Decide what the viewer should understand or do next.",
    notes:
      "A film can teach an idea, show a process, introduce a product, or invite someone to take a next step. Choose the purpose that matters most. When your destination is clear, the scenes can build toward it instead of competing for attention.",
    steps: ["Understand", "Feel", "Act"],
  },
  {
    title: "Build a beginning",
    body: "Offer a reason to keep watching.",
    notes:
      "Your opening does not need to explain everything. It needs to give the viewer a reason to continue. Show a familiar problem, ask a useful question, or introduce a contrast. Then make a promise that the rest of the film can actually keep.",
    steps: ["Hook", "Context", "Promise"],
  },
  {
    title: "Show the work",
    body: "Use specific examples to make an abstract idea concrete.",
    notes:
      "Now show the idea at work. Choose details that answer the viewer's questions, and arrange them in an order that is easy to follow. A small, specific example often explains more than a broad claim. Let each scene add a new piece of understanding.",
    steps: ["Example", "Evidence", "Meaning"],
  },
  {
    title: "Find a clear rhythm",
    body: "Give important moments enough space to land.",
    notes:
      "Rhythm comes from the relationship between information and time. Leave enough room for a title to be read, a comparison to be understood, or an image to make its point. Shorten repetition, vary the emphasis, and keep the journey moving toward its purpose.",
    steps: ["Emphasize", "Pause", "Continue"],
  },
  {
    title: "Let sound support\nthe story",
    body: "A clear voice should remain easy to hear.",
    notes:
      "Sound can guide attention and give a film warmth. If you use narration, record in a quiet place and listen back before moving on. Keep music and source sound below the voice when the words matter. Silence can also give an important moment room to breathe.",
    steps: ["Record", "Listen", "Balance"],
  },
  {
    title: "Make every word count",
    body: "Use captions and on-screen text with care.",
    notes:
      "On-screen words should help the viewer follow the idea. Keep titles concise, break captions at natural phrases, and allow enough reading time. Check the film on a smaller screen as well as your main display. Clear language and readable type make the story easier to share.",
    steps: ["Simplify", "Caption", "Check"],
  },
  {
    title: "Review. Refine. Share.",
    body: "Watch the whole film once before publishing.",
    notes:
      "Watch the complete film from the beginning. Look for a clear opening, a useful middle, and an ending that follows naturally from the idea. Check the sound, captions, timing, and final frame. Make the last adjustments, then share something you would be proud to put your name on.",
    steps: ["Review", "Refine", "Share"],
  },
];
const story: Outline[] = [
  {
    title: "What matters\nto you?",
    body: "Every worthwhile project begins with a reason.",
    notes:
      "Start with why this work matters. Tell your audience who you want to help and what you want to make better. Use a specific observation or a real experience. A clear purpose gives the rest of your story something honest to build on.",
    steps: ["Purpose", "People", "Possibility"],
  },
  {
    title: "Show your process",
    body: "Let people see the care behind the result.",
    notes:
      "Bring the audience into your process. Show a decision, a useful detail, or a moment of care that usually stays behind the scenes. You can add your own footage or photographs here, and record the explanation in your own voice.",
    steps: ["Think", "Make", "Improve"],
  },
  {
    title: "Make the difference\nvisible",
    body: "Show a real example rather than an unsupported promise.",
    notes:
      "Now show what the work makes possible. Choose an example you can stand behind: a finished piece, a practical result, or a clear before-and-after. Explain the difference in plain language, and let the evidence support the story.",
    steps: ["Example", "Change", "Result"],
  },
  {
    title: "Invite the next step",
    body: "End with an invitation that fits your purpose.",
    notes:
      "Bring the story back to the purpose you started with. Tell the viewer what they can do next, whether that is seeing more work, asking a question, or trying the idea themselves. Keep the invitation clear, useful, and true to the story you have told.",
    steps: ["Discover", "Connect", "Continue"],
  },
];

// All artwork and words here are authored studio templates, with no external
// assets, model calls, hidden media or unresolved placeholders in the timeline.
export function creatorTemplateTimeline(id: CreatorTemplateId): Timeline {
  const template = creatorTemplate(id);
  const outline =
    id === "vertical-launch"
      ? launch
      : id === "clear-explainer"
        ? explainer
        : story;
  const portrait = template.format === "portrait";
  const durationFrames = (template.duration * 30) / outline.length;
  const scenes: Scene[] = outline.map((item, index) => {
    const accent = ["#D3F4A1", "#B6BEFF", "#F7CFA0"][index % 3];
    const text = (
      key: string,
      content: string,
      x: number,
      y: number,
      width: number,
      height: number,
      fontSize: number,
      color = "#F5F5F0",
    ): Layer => ({
      id: key,
      kind: "text",
      text: content,
      x,
      y,
      width,
      height,
      fontSize,
      color,
      animation: "none",
      fontFamily: "sans",
      fontWeight: "regular",
      lineHeight: 1.15,
    });
    const layers: Layer[] = [
      text(
        "eyebrow",
        `${String(index + 1).padStart(2, "0")} / ${String(outline.length).padStart(2, "0")}  ·  ${id === "clear-explainer" ? "STORY LAB" : "YOUR CREATIVE STUDIO"}`,
        0.08,
        0.07,
        0.84,
        0.06,
        18,
        accent,
      ),
      {
        ...text(
          "title",
          item.title,
          0.08,
          0.18,
          0.84,
          portrait ? 0.23 : 0.2,
          portrait ? 64 : 56,
        ),
        fontWeight: "bold",
        animation: id === "clear-explainer" ? "none" : "rise",
      },
      text("body", item.body, 0.08, 0.43, 0.84, 0.13, portrait ? 34 : 28),
      {
        id: "progress",
        kind: "rectangle",
        x: 0.08,
        y: 0.59,
        width: (0.84 * (index + 1)) / outline.length,
        height: 0.01,
        text: "",
        color: accent,
        fontSize: 12,
        animation: "none",
      },
    ];
    for (const [step, label] of item.steps.entries()) {
      const x = portrait ? 0.08 : 0.08 + step * 0.29,
        y = portrait ? 0.65 + step * 0.07 : 0.66;
      const width = portrait ? 0.84 : 0.26,
        height = portrait ? 0.055 : 0.11;
      layers.push(
        {
          id: `card-${step}`,
          kind: "rectangle",
          x,
          y,
          width,
          height,
          text: "",
          color: "#263744",
          fontSize: 12,
          animation: "none",
        },
        {
          ...text(
            `step-${step}`,
            label,
            x + 0.015,
            y,
            width - 0.03,
            height,
            portrait ? 28 : 24,
            accent,
          ),
          fontWeight: "medium",
          textAlign: "center",
        },
      );
    }
    return {
      id: `${id}-${index + 1}`,
      title: item.title.replaceAll("\n", " "),
      intent: item.notes,
      durationFrames,
      background: ["#101D31", "#18243A", "#142D2B"][index % 3],
      accent,
      strategy: "typography",
      transition: "cut",
      layers,
    };
  });
  return timelineSchema.parse({
    fps: 30,
    format: template.format,
    exportResolution: "1080p",
    scenes,
    captionStyle: {
      fontSize: 28,
      position: "bottom",
      backgroundOpacity: 0.87,
      margin: 3,
    },
    captions: outline.flatMap((item, index) =>
      sceneNoteCues(
        item.notes,
        index * durationFrames,
        durationFrames,
        `template-${id}-${index + 1}`,
      ),
    ),
  });
}
