import { createServer, type Server } from "node:http";
import { chromium } from "playwright-core";
import sharp from "sharp";
import {
  chromiumCrashArgs,
  SAME_PROCESS_SANDBOXED_FRAMES,
  SOFTWARE_WEBGL,
} from "../lib/chromium-flags";
import { serveMotionFile } from "./motion-files";
import { motionDocument, motionStages, type MotionCode } from "./document";
import {
  CONTENT_BOUNDS_SOURCE,
  COVERAGE_SOURCE,
  LAYOUT_AUDIT_SOURCE,
} from "./audit";

// Runs one code scene headlessly and captures stills at chosen times, with
// every uncaught error and simple pixel measurements. Used to check generated
// scenes before they enter a film (and to show the director its own work).
export type MotionPreviewFrame = {
  time: number;
  png: Buffer;
  // Standard deviation of luminance: near zero means a flat, empty frame.
  detail: number;
  // Mean absolute luminance change from the previous captured frame (0–255).
  change: number | null;
};
export type MotionPreview = {
  frames: MotionPreviewFrame[];
  errors: string[];
  loaded: boolean;
  // Layout notes from the in-scene audit, prefixed with their time.
  layout: string[];
  // Box of the visible content at `boundsAt`, in stage pixels.
  bounds: { x: number; y: number; w: number; h: number } | null;
  // Change from the previous capture at every captured moment (stills and
  // motion probes), in time order.
  motion: { time: number; change: number }[];
  // The stage's area in stage pixels (for coverage shares).
  stageArea: number;
  // Box of the visible content at each `coverageAt` time.
  coverage: {
    time: number;
    bounds: { x: number; y: number; w: number; h: number } | null;
  }[];
};
export async function previewMotionScene(input: {
  code: MotionCode;
  format: keyof typeof motionStages;
  durationSeconds: number;
  times: number[];
  // Width of the captured stills in pixels (height follows the format).
  width?: number;
  seed?: number;
  timeoutMs?: number;
  // Captured times at which to run the layout audit.
  auditAt?: number[];
  // A time at which to measure the content's bounds (no still is captured
  // unless it is also one of `times`).
  boundsAt?: number;
  // Extra moments captured only to measure motion (no still is returned).
  probeTimes?: number[];
  // Moments at which to measure how much of the frame the content covers.
  coverageAt?: number[];
  // Bytes of the project images the scene declares (code.assets).
  assets?: Record<string, { bytes: Buffer; type: string }>;
}): Promise<MotionPreview> {
  const stage = motionStages[input.format];
  const width = input.width ?? (input.format === "portrait" ? 540 : 960);
  const height = Math.round((width * stage.height) / stage.width);
  const deadline = Date.now() + (input.timeoutMs ?? 60000);
  const errors: string[] = [];
  const server: Server = createServer((req, res) => {
    const match = /^\/motion\/([A-Za-z0-9./-]+)$/.exec(req.url || "");
    const served = match ? serveMotionFile(match[1]) : null;
    if (served) {
      const { bytes, type } = served;
      res.writeHead(200, {
        "Content-Type": type,
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "no-store",
      });
      res.end(bytes);
      return;
    }
    const image = /^\/asset\/([a-f0-9-]{36})$/.exec(req.url || "");
    const file = image ? input.assets?.[image[1]] : undefined;
    if (file) {
      res.writeHead(200, {
        "Content-Type": file.type,
        "Cache-Control": "no-store",
      });
      res.end(file.bytes);
      return;
    }
    if (req.url === "/host") {
      // In-page helpers live here rather than in evaluate() callbacks.
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(`<!doctype html><body style="margin:0;background:#000">
<iframe id="scene" sandbox="allow-scripts" style="display:block;border:0;width:${width}px;height:${height}px"></iframe>
<script>
const scene = document.getElementById("scene");
window.sceneErrors = [];
let loaded, replies = new Map(), next = 0;
addEventListener("message", (event) => {
  if (event.source !== scene.contentWindow) return;
  const data = event.data || {};
  if (data.reelchemy === "error" && sceneErrors.length < 50) sceneErrors.push(String(data.message));
  if (data.reelchemy === "assets" || data.reelchemy === "loaded") sendAssets(event.source);
  if (data.reelchemy === "loaded" && loaded) loaded(true);
  if (replies.has(data.id)) { replies.get(data.id)(data.reelchemy); replies.delete(data.id); }
});
let sentTo = null;
const sendAssets = async (target) => {
  if (sentTo === target) return;
  sentTo = target;
  const files = {};
  for (const id of ${JSON.stringify(Object.keys(input.assets || {}))}) {
    const response = await fetch("/asset/" + id);
    files[id] = { bytes: await response.arrayBuffer(), type: response.headers.get("content-type") };
  }
  target.postMessage({ reelchemy: "assets", files }, "*");
};
window.loadScene = (doc, wait) => new Promise((resolve) => {
  loaded = resolve;
  setTimeout(() => resolve(false), wait);
  scene.srcdoc = doc;
});
window.seekScene = (time) => new Promise((resolve) => {
  const id = ++next;
  replies.set(id, resolve);
  scene.contentWindow.postMessage({ reelchemy: "seek", id, time }, "*");
});
</script></body>`);
      return;
    }
    res.writeHead(404).end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
    args: [
      "--no-sandbox",
      ...chromiumCrashArgs(),
      ...SAME_PROCESS_SANDBOXED_FRAMES,
      ...SOFTWARE_WEBGL,
    ],
    timeout: 30000,
  });
  const remaining = () => {
    const ms = deadline - Date.now();
    if (ms <= 0) throw new Error("Scene preview timed out.");
    return ms;
  };
  try {
    const page = await browser.newPage({ viewport: { width, height } });
    await page.goto(`${base}/host`, { timeout: remaining() });
    type HostWindow = {
      loadScene(doc: string, wait: number): Promise<boolean>;
      seekScene(time: number): Promise<string>;
      sceneErrors: string[];
    };
    const loaded = await page.evaluate(
      ([doc, wait]) =>
        (window as unknown as HostWindow).loadScene(
          doc as string,
          wait as number,
        ),
      [
        motionDocument({
          code: input.code,
          baseUrl: `${base}/motion`,
          format: input.format,
          width,
          height,
          fps: 30,
          durationSeconds: input.durationSeconds,
          seed: input.seed ?? 1,
        }),
        Math.min(30000, remaining()),
      ] as const,
    );
    const frames: MotionPreviewFrame[] = [];
    const layout: string[] = [];
    let bounds: MotionPreview["bounds"] = null;
    const clampTime = (t: number) =>
      Math.max(0, Math.min(input.durationSeconds, t));
    const stills = new Set(input.times.map((t) => clampTime(t).toFixed(3)));
    const boundsKey =
      input.boundsAt === undefined
        ? undefined
        : clampTime(input.boundsAt).toFixed(3);
    const probes = new Set(
      (input.probeTimes ?? []).map((t) => clampTime(t).toFixed(3)),
    );
    const coverageKeys = new Set(
      (input.coverageAt ?? []).map((t) => clampTime(t).toFixed(3)),
    );
    const motion: MotionPreview["motion"] = [];
    const coverage: MotionPreview["coverage"] = [];
    const audits = new Set(
      (input.auditAt ?? []).map((t) =>
        Math.max(0, Math.min(input.durationSeconds, t)).toFixed(3),
      ),
    );
    if (loaded) {
      let previous: Buffer | undefined, previousCoarse: Buffer | undefined;
      const sequence = [
        ...new Set([
          ...stills,
          ...probes,
          ...coverageKeys,
          ...(boundsKey === undefined ? [] : [boundsKey]),
        ]),
      ]
        .map(Number)
        .sort((a, b) => a - b);
      for (const clamped of sequence) {
        const reply = await Promise.race([
          page.evaluate(
            (seconds) => (window as unknown as HostWindow).seekScene(seconds),
            clamped,
          ),
          new Promise<string>((resolve) =>
            setTimeout(() => resolve("timeout"), Math.min(15000, remaining())),
          ),
        ]);
        if (reply !== "ready") {
          errors.push(
            `The scene did not reach ${clamped.toFixed(2)}s (${reply}).`,
          );
          break;
        }
        if (audits.has(clamped.toFixed(3))) {
          const sceneFrame = page.frames().find((f) => f !== page.mainFrame());
          const notes = sceneFrame
            ? ((await sceneFrame
                .evaluate(LAYOUT_AUDIT_SOURCE)
                .catch(() => [])) as string[])
            : [];
          // Report each problem once, at the first time it was seen.
          for (const note of notes) {
            const key = note.replace(/ \(and \d+ similar\)$/, "");
            if (!layout.some((seen) => seen.includes(key)))
              layout.push(`At ${clamped.toFixed(1)}s: ${note}`);
          }
        }
        if (boundsKey === clamped.toFixed(3)) {
          const sceneFrame = page.frames().find((f) => f !== page.mainFrame());
          bounds = sceneFrame
            ? ((await sceneFrame
                .evaluate(CONTENT_BOUNDS_SOURCE)
                .catch(() => null)) as MotionPreview["bounds"])
            : null;
        }
        if (coverageKeys.has(clamped.toFixed(3))) {
          const sceneFrame = page.frames().find((f) => f !== page.mainFrame());
          coverage.push({
            time: clamped,
            bounds: sceneFrame
              ? ((await sceneFrame
                  .evaluate(COVERAGE_SOURCE)
                  .catch(() => null)) as MotionPreview["bounds"])
              : null,
          });
        }
        const key = clamped.toFixed(3);
        if (!stills.has(key) && !probes.has(key)) continue;
        // Motion is measured without the ambience (grid, glows, particles,
        // film finish), on a small softened copy: a frozen composition with
        // drifting specks still reads as frozen.
        const sceneFrame = page.frames().find((f) => f !== page.mainFrame());
        await sceneFrame?.evaluate(PROBE_HIDE_AMBIENCE).catch(() => undefined);
        const bare = await page.screenshot({ type: "png" });
        await sceneFrame?.evaluate(PROBE_SHOW_AMBIENCE).catch(() => undefined);
        const png = stills.has(key)
          ? await page.screenshot({ type: "png" })
          : bare;
        const coarse = await sharp(bare)
          .resize({ width: 160 })
          .blur(0.8)
          .greyscale()
          .raw()
          .toBuffer();
        if (previousCoarse) {
          let delta = 0;
          for (let i = 0; i < coarse.length; i++)
            delta += Math.abs(coarse[i] - previousCoarse[i]);
          motion.push({ time: clamped, change: delta / coarse.length });
        }
        previousCoarse = coarse;
        const gray = await sharp(png).greyscale().raw().toBuffer();
        let sum = 0,
          squares = 0;
        for (const value of gray) {
          sum += value;
          squares += value * value;
        }
        const mean = sum / gray.length;
        let change: number | null = null;
        if (previous) {
          let delta = 0;
          for (let i = 0; i < gray.length; i++)
            delta += Math.abs(gray[i] - previous[i]);
          change = delta / gray.length;
        }
        previous = gray;
        if (!stills.has(key)) continue;
        frames.push({
          time: clamped,
          png,
          detail: Math.sqrt(Math.max(0, squares / gray.length - mean * mean)),
          change,
        });
      }
    } else errors.push("The scene did not finish loading.");
    errors.unshift(
      ...(await page.evaluate(() =>
        (window as unknown as HostWindow).sceneErrors.slice(0, 50),
      )),
    );
    return {
      frames,
      errors,
      loaded,
      layout,
      bounds,
      motion,
      coverage,
      stageArea: stage.width * stage.height,
    };
  } finally {
    await browser.close().catch(() => {});
    server.close();
  }
}

const PROBE_HIDE_AMBIENCE = `(() => { const s = document.createElement("style"); s.id = "r-probe"; s.textContent = ".r-grid,.r-glow,.r-particles,.r-particle,.r-finish{visibility:hidden !important}"; document.head.appendChild(s); })()`;
const PROBE_SHOW_AMBIENCE = `document.getElementById("r-probe")?.remove()`;

// A single image with the stills side by side in rows, for review.
export async function contactSheet(frames: MotionPreviewFrame[], columns = 3) {
  if (!frames.length) throw new Error("No frames to show.");
  columns = Math.max(1, Math.min(columns, frames.length));
  const meta = await sharp(frames[0].png).metadata();
  const w = meta.width!,
    h = meta.height!,
    gap = 8;
  const rows = Math.ceil(frames.length / columns);
  return sharp({
    create: {
      width: columns * w + (columns - 1) * gap,
      height: rows * h + (rows - 1) * gap,
      channels: 3,
      background: "#202020",
    },
  })
    .composite(
      frames.map((frame, i) => ({
        input: frame.png,
        left: (i % columns) * (w + gap),
        top: Math.floor(i / columns) * (h + gap),
      })),
    )
    .png()
    .toBuffer();
}
