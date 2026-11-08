import { createServer, type Server } from "node:http";
import { chromium } from "playwright-core";
import sharp from "sharp";
import {
  chromiumCrashArgs,
  SAME_PROCESS_SANDBOXED_FRAMES,
} from "../lib/chromium-flags";
import { isMotionFile } from "./libraries";
import { readMotionFile } from "./motion-files";
import { motionDocument, motionStages, type MotionCode } from "./document";
import { CONTENT_BOUNDS_SOURCE, LAYOUT_AUDIT_SOURCE } from "./audit";

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
}): Promise<MotionPreview> {
  const stage = motionStages[input.format];
  const width = input.width ?? (input.format === "portrait" ? 540 : 960);
  const height = Math.round((width * stage.height) / stage.width);
  const deadline = Date.now() + (input.timeoutMs ?? 60000);
  const errors: string[] = [];
  const server: Server = createServer((req, res) => {
    const match = /^\/motion\/([A-Za-z0-9./-]+)$/.exec(req.url || "");
    if (match && isMotionFile(match[1])) {
      const { bytes, type } = readMotionFile(match[1]);
      res.writeHead(200, {
        "Content-Type": type,
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "no-store",
      });
      res.end(bytes);
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
  if (data.reelchemy === "loaded" && loaded) loaded(true);
  if (replies.has(data.id)) { replies.get(data.id)(data.reelchemy); replies.delete(data.id); }
});
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
    const audits = new Set(
      (input.auditAt ?? []).map((t) =>
        Math.max(0, Math.min(input.durationSeconds, t)).toFixed(3),
      ),
    );
    if (loaded) {
      let previous: Buffer | undefined;
      const sequence = [
        ...new Set([
          ...stills,
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
        if (!stills.has(clamped.toFixed(3))) continue;
        const png = await page.screenshot({ type: "png" });
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
    return { frames, errors, loaded, layout, bounds };
  } finally {
    await browser.close().catch(() => {});
    server.close();
  }
}

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
