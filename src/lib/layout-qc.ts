import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { chromium } from "playwright-core";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { formats, type Timeline, type QCIssue } from "./schema";
import { textStyle } from "./text-style";
export class RenderQCError extends Error {
  constructor(public issues: QCIssue[]) {
    super(issues.map((i) => i.message).join(" "));
  }
}
// Uses the exact text styles used in compositions. These are static layout diagnostics,
// not screenshots of the final animation or a semantic/motion approval.
export async function checkLayout(
  input: Timeline,
  outputDir: string,
  cancelled: () => boolean = () => false,
) {
  const timeline = structuredClone(input);
  await mkdir(outputDir, { recursive: true });
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
    args: ["--no-sandbox"],
  });
  const page = await browser.newPage({ viewport: formats[timeline.format] });
  await page.route("**/*", (r) => r.abort());
  const before: QCIssue[] = [],
    after: QCIssue[] = [],
    changes: {
      sceneId: string;
      layerId: string;
      before: number;
      after: number;
    }[] = [];
  try {
    for (const [i, scene] of timeline.scenes.entries()) {
      if (cancelled()) throw new Error("Render cancelled.");
      for (let pass = 0; pass <= 2; pass++) {
        await page.setContent(
          renderToStaticMarkup(
            React.createElement(
              "div",
              {
                style: {
                  position: "absolute",
                  inset: 0,
                  background: scene.background,
                  fontFamily: "Arial, sans-serif",
                },
              },
              ...scene.layers
                .filter((l) => l.kind === "text")
                .map((l) =>
                  React.createElement(
                    "div",
                    {
                      key: l.id,
                      "data-layer-id": l.id,
                      style: {
                        position: "absolute",
                        left: l.x * formats[timeline.format].width,
                        top: l.y * formats[timeline.format].height,
                        width: l.width * formats[timeline.format].width,
                        height: l.height * formats[timeline.format].height,
                        display: "flex",
                        alignItems: "center",
                        overflow: "hidden",
                        color: l.color,
                      },
                    },
                    React.createElement(
                      "div",
                      { style: textStyle(l, formats[timeline.format].width) },
                      l.text,
                    ),
                  ),
                ),
            ),
          ),
        );
        const metrics = await page
          .locator("[data-layer-id]")
          .evaluateAll((nodes) =>
            nodes.map((n) => {
              const outer = n.getBoundingClientRect(),
                inner = n.firstElementChild!.getBoundingClientRect();
              return {
                id: n.getAttribute("data-layer-id")!,
                width: outer.width,
                height: outer.height,
                textWidth: inner.width,
                textHeight: inner.height,
              };
            }),
          );
        const issues: QCIssue[] = metrics
          .filter(
            (m) => m.textHeight > m.height + 1 || m.textWidth > m.width + 1,
          )
          .map((m) => ({
            sceneId: scene.id,
            layerId: m.id,
            code: "text-overflow",
            severity: "error",
            message: `Text ${m.id} is clipped in scene ${scene.title}.`,
          }));
        if (pass === 0) {
          before.push(...issues);
          await page.screenshot({
            path: path.join(outputDir, `layout-${i + 1}-before.png`),
          });
        }
        if (!issues.length || pass === 2) {
          after.push(...issues);
          await page.screenshot({
            path: path.join(outputDir, `layout-${i + 1}-after.png`),
          });
          break;
        }
        for (const issue of issues) {
          const layer = scene.layers.find((l) => l.id === issue.layerId)!;
          const m = metrics.find((m) => m.id === layer.id)!;
          const previous = layer.fontSize;
          layer.fontSize = Math.max(
            12,
            Math.floor(
              layer.fontSize *
                Math.min(m.height / m.textHeight, m.width / m.textWidth) *
                0.94,
            ),
          );
          if (layer.fontSize !== previous)
            changes.push({
              sceneId: scene.id,
              layerId: layer.id,
              before: previous,
              after: layer.fontSize,
            });
        }
      }
    }
  } finally {
    await browser.close();
  }
  return {
    timeline,
    before,
    after,
    changes,
    method: "Chromium static text geometry; no semantic or temporal claim",
    maxRepairPasses: 2,
  };
}
