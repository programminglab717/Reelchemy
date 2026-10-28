import { mkdir, writeFile } from "node:fs/promises";
import { getProject, saveProject, reviseProject } from "../src/lib/db";
import { mockPlan } from "../src/lib/provider";
import type { CreativeBrief } from "../src/lib/schema";
const samples: { id: string; brief: CreativeBrief }[] = [
  {
    id: "sample-explainer",
    brief: {
      prompt: "How a small idea becomes a connected system.",
      duration: 30,
      format: "landscape",
    },
  },
  {
    id: "sample-landscape",
    brief: {
      prompt: "A quiet journey through mountains at sunrise.",
      duration: 30,
      format: "portrait",
    },
  },
  {
    id: "sample-promo",
    brief: {
      prompt: "Make room for your next big idea. A creative notebook launch.",
      duration: 15,
      format: "square",
    },
  },
];
if (process.argv.includes("--write-examples"))
  await mkdir("examples", { recursive: true });
for (const { id, brief } of samples) {
  const timeline = mockPlan(brief);
  if (process.argv.includes("--write-examples"))
    await writeFile(
      `examples/${id}.json`,
      JSON.stringify(timeline, null, 2) + "\n",
    );
  if (getProject(id)) continue;
  const p = saveProject({
    id,
    name: brief.prompt,
    brief,
    timeline: null,
    revisions: [],
    messages: [
      { role: "user", content: brief.prompt },
      {
        role: "assistant",
        content:
          "Seeded demo storyboard. Select a scene to edit, then approve an export.",
      },
    ],
    createdAt: new Date().toISOString(),
  });
  reviseProject(p, timeline, "Seeded demo");
}
console.log(
  "Three sample projects available. Existing samples were preserved.",
);
