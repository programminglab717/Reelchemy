import { chromiumCrashArgs } from "./chromium-flags";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { chromium } from "playwright-core";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { videoDimensions, type Timeline, type QCIssue } from "./schema";
import { textStyle, fontFaceFamily } from "./text-style";
import { CaptionOverlay } from "../video/CaptionOverlay";
import { CommandCancelledError, CommandTimeoutError } from "./process";
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
  assetSources: Record<string, string> = {},
) {
  if (cancelled()) throw new CommandCancelledError();
  const deadline = Date.now() + 60000;
  const timeline = structuredClone(input);
  await mkdir(outputDir, { recursive: true });
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
    args: ["--no-sandbox", ...chromiumCrashArgs()],
    timeout: 30000,
  });
  let reason: Error | undefined, closing: Promise<void> | undefined;
  const close = () => (closing ??= browser.close());
  const stop = () => {
    if (cancelled()) reason ??= new CommandCancelledError();
    else if (Date.now() >= deadline) reason ??= new CommandTimeoutError();
    if (reason) void close().catch(() => {});
  };
  const timer = setInterval(stop, 100);
  const before: QCIssue[] = [],
    after: QCIssue[] = [],
    changes: {
      sceneId: string;
      layerId: string;
      before: number;
      after: number;
    }[] = [];
  try {
    stop();
    if (reason) throw reason;
    const page = await browser.newPage({ viewport: videoDimensions(timeline) });
    page.setDefaultTimeout(15000);
    page.setDefaultNavigationTimeout(15000);
    // Only this attempt's private font URLs may load; everything else stays
    // blocked so measured text cannot depend on outside resources.
    const fontUrls = new Set(
      timeline.scenes.flatMap((scene) =>
        scene.layers.flatMap((l) =>
          l.fontAssetId && assetSources[l.fontAssetId]
            ? [assetSources[l.fontAssetId]]
            : [],
        ),
      ),
    );
    await page.route("**/*", (r) =>
      fontUrls.has(r.request().url()) ? r.continue() : r.abort(),
    );
    for (const [i, scene] of timeline.scenes.entries()) {
      if (cancelled()) throw new Error("Render cancelled.");
      // Code scenes draw their own text; their layout is checked when they
      // are written (motion preflight), not from layers.
      if (scene.code) continue;
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
                .filter((l) => l.kind === "text" && !l.hidden)
                .map((l) =>
                  React.createElement(
                    "div",
                    {
                      key: l.id,
                      "data-layer-id": l.id,
                      style: {
                        position: "absolute",
                        left: l.x * videoDimensions(timeline).width,
                        top: l.y * videoDimensions(timeline).height,
                        width: l.width * videoDimensions(timeline).width,
                        height: l.height * videoDimensions(timeline).height,
                        display: "flex",
                        alignItems: "center",
                        overflow: "hidden",
                        color: l.color,
                      },
                    },
                    React.createElement(
                      "div",
                      { style: textStyle(l, videoDimensions(timeline).width) },
                      l.text,
                    ),
                  ),
                ),
            ),
          ),
        );
        const fonts = [
          ...new Set(
            scene.layers.flatMap((l) =>
              l.kind === "text" && !l.hidden && l.fontAssetId
                ? [l.fontAssetId]
                : [],
            ),
          ),
        ];
        const unavailable = fonts.filter((id) => !assetSources[id]);
        const failed = await page.evaluate(
          async (faces) => {
            const failures: string[] = [];
            for (const [id, family, src] of faces) {
              const present = [...document.fonts].some(
                (f) =>
                  f.family.replace(/^"|"$/g, "") === family &&
                  f.status === "loaded",
              );
              if (present) continue;
              try {
                const face = new FontFace(
                  family,
                  `url(${JSON.stringify(src)})`,
                );
                document.fonts.add(await face.load());
              } catch {
                failures.push(id);
              }
            }
            return failures;
          },
          fonts
            .filter((id) => assetSources[id])
            .map(
              (id) =>
                [id, fontFaceFamily(id), assetSources[id]] as [
                  string,
                  string,
                  string,
                ],
            ),
        );
        if (unavailable.length || failed.length)
          throw new RenderQCError(
            [...unavailable, ...failed].map((id) => ({
              sceneId: scene.id,
              code: "missing-asset",
              severity: "error",
              message: `The uploaded font ${id} could not be loaded in scene ${scene.title}. Upload a valid font file or choose another font.`,
            })),
          );
        const metrics = await page
          .locator("[data-layer-id]")
          .evaluateAll((nodes) =>
            nodes.map((n) => {
              const outer = n.getBoundingClientRect(),
                text = n.firstElementChild!,
                inner = text.getBoundingClientRect();
              return {
                id: n.getAttribute("data-layer-id")!,
                width: outer.width,
                height: outer.height,
                textWidth: Math.max(inner.width, text.scrollWidth),
                textHeight: Math.max(inner.height, text.scrollHeight),
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
    // Measure every cue, including cues between sampled scene screenshots.
    // Report clipping instead of changing user-selected caption appearance.
    for (const caption of timeline.captions || []) {
      if (cancelled()) throw new Error("Render cancelled.");
      await page.setContent(
        renderToStaticMarkup(
          React.createElement(CaptionOverlay, {
            timeline,
            text: caption.text,
            id: caption.id,
          }),
        ),
      );
      const clipped = await page
        .locator("[data-caption-id]")
        .evaluate(
          (n) =>
            n.scrollHeight > n.clientHeight + 1 ||
            n.scrollWidth > n.clientWidth + 1,
        );
      if (clipped) {
        const issue: QCIssue = {
          sceneId: "captions",
          layerId: caption.id,
          code: "text-overflow",
          severity: "error",
          message: `Caption ${caption.id} is clipped. Reduce its font size or shorten the cue.`,
        };
        before.push(issue);
        after.push(issue);
      }
    }
  } catch (error) {
    throw reason || error;
  } finally {
    clearInterval(timer);
    await close();
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
