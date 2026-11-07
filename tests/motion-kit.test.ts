import { test } from "node:test";
import assert from "node:assert/strict";
import { previewMotionScene } from "../src/motion/preflight";
import { cacheAsideScene } from "../src/motion/examples/cache-aside";
import { compoundGrowthScene } from "../src/motion/examples/compound-growth";

// A scene that checks the kit from inside: each check runs at a moment on the
// timeline and throws (reported as a scene error) when the kit misbehaves.
const selfChecking = {
  html: `<div class="world" style="position:absolute;inset:0"></div><div class="editor" style="position:absolute;left:200px;top:700px;width:900px"></div><div class="n" style="position:absolute;left:1300px;top:700px;font-size:60px">0</div>`,
  css: "",
  js: String.raw`
R.theme({ background: "#050816", accents: ["#38bdf8", "#f472b6"] });
const check = (ok, message) => { if (!ok) throw new Error("CHECK " + message); };
const near = (a, b, tolerance) => Math.abs(a - b) <= (tolerance || 2);
const world = document.querySelector(".world");
const a = R.node({ parent: world, x: 400, y: 300, w: 300, label: "A" });
const b = R.node({ parent: world, x: 1400, y: 300, w: 300, label: "B", icon: "database" });
check(near(R.box(a).x, 250) && near(R.box(a).w, 300), "node is centred on x,y: " + JSON.stringify(R.box(a)));
const link = R.connect(a, b, { arrow: true });
const start = link.path.getPointAtLength(0), end = link.path.getPointAtLength(link.length);
check(near(start.x, 550 + 10) && near(start.y, 300), "connector starts at A's right edge: " + start.x + "," + start.y);
check(near(end.x, 1250 - 12) && near(end.y, 300), "connector ends at B's left edge: " + end.x + "," + end.y);
check(link.group.ownerSVGElement.parentElement === world, "connector is drawn inside the nodes' container");
const ring = R.ring(b);
check(ring.group.ownerSVGElement.parentElement === world, "ring is drawn inside the node's container");
const code = R.code(".editor", "SELECT *\nFROM users -- all\nWHERE id = 42;", { lang: "sql" });
check(document.querySelectorAll(".editor .r-ln").length === 3, "code has three lines");
check(document.querySelector(".editor .tk-k").textContent === "SELECT", "keywords are highlighted");
check(document.querySelector(".editor .tk-c").textContent === "-- all", "comments are highlighted");
check(document.querySelector(".editor .tk-n").textContent === "42", "numbers are highlighted");
const tl = gsap.timeline();
tl.add(link.draw({ duration: 1 }), 1)
  .add(R.flow(link, { count: 1, duration: 1 }), 2)
  .add(code.type({ duration: 1 }), 1)
  .add(R.count(".n", 1234.5, { decimals: 1, duration: 1 }), 1)
  .add(R.focus(world, b, { scale: 2, at: [960, 540], duration: 0.5 }), 3);
// A ring around the counter is measured when it starts drawing, after the
// number has grown, not when the timeline was built.
const counterRing = R.ring(".n", { pad: 0, radius: 0, glow: false });
tl.add(counterRing.draw({ duration: 0.2 }), 2.5);
const visibleChars = () => [...document.querySelectorAll(".editor .r-ch")].filter((c) => c.style.visibility !== "hidden").length;
tl.call(() => {
  check(link.progress === 0, "an undrawn connector is hidden before its draw starts");
  check(link.heads[0].style.opacity === "0", "the arrowhead waits for the draw");
  check(visibleChars() === 0, "typing starts empty");
  check(document.querySelector(".n").textContent === "0.0", "the counter starts at its from value");
}, [], 0.5)
  .call(() => {
    check(link.progress > 0.2 && link.progress < 0.8, "the connector is mid-draw: " + link.progress);
    const total = document.querySelectorAll(".editor .r-ch").length;
    check(visibleChars() > 0 && visibleChars() < total, "typing is in progress");
  }, [], 1.5)
  .call(() => {
    const dot = document.querySelector(".r-packet");
    check(dot && Number(dot.style.opacity) > 0.9, "a packet is in flight");
    check(near(Number(dot.getAttribute("cy")), 300, 1), "the packet rides the connector");
  }, [], 2.5)
  .call(() => {
    check(link.progress === 1, "the connector is fully drawn");
    check(document.querySelector(".n").textContent === "1,234.5", "the counter lands on its value: " + document.querySelector(".n").textContent);
    check(visibleChars() === document.querySelectorAll(".editor .r-ch").length, "the code is fully typed");
    const r = b.getBoundingClientRect(), s = R.stage.getBoundingClientRect(), k = s.width / R.width;
    check(near((r.left - s.left + r.width / 2) / k, 960, 3) && near((r.top - s.top + r.height / 2) / k, 540, 3), "the camera centres the target");
    check(near(r.width / k, 600, 3), "the camera zooms the target");
    const framed = counterRing.path.getBBox(), counter = R.box(".n");
    check(near(framed.width, counter.w, 2) && counter.w > 150, "the ring frames the grown counter: " + framed.width + " vs " + counter.w);
  }, [], 3.9);
`,
};

test(
  "the kit routes connectors from layout, draws, flows, types, counts and moves the camera",
  { timeout: 120000 },
  async () => {
    const result = await previewMotionScene({
      code: selfChecking,
      format: "landscape",
      durationSeconds: 4,
      times: [0, 0.6, 1.6, 2.6, 4],
      width: 480,
    });
    assert(result.loaded);
    assert.deepEqual(result.errors, []);
    // Deterministic: a second run produces identical frames.
    const again = await previewMotionScene({
      code: selfChecking,
      format: "landscape",
      durationSeconds: 4,
      times: [0, 0.6, 1.6, 2.6, 4],
      width: 480,
    });
    assert.deepEqual(
      again.frames.map((f) => f.png.toString("base64")),
      result.frames.map((f) => f.png.toString("base64")),
    );
  },
);

test(
  "the kit reference scene meets its own checks: no errors or layout notes, and it keeps moving",
  { timeout: 120000 },
  async () => {
    const times = Array.from({ length: 9 }, (_, i) => (14 * i) / 8);
    const result = await previewMotionScene({
      code: cacheAsideScene,
      format: "landscape",
      durationSeconds: 14,
      times,
      auditAt: times.slice(2),
    });
    assert.deepEqual(result.errors, []);
    assert.deepEqual(result.layout, []);
    assert(result.frames.slice(1, -1).every((f) => f.change! > 0.1));
    assert(result.frames.slice(1).every((f) => f.detail > 5));
  },
);

test(
  "the portrait reference scene meets its own checks",
  { timeout: 120000 },
  async () => {
    const times = Array.from({ length: 7 }, (_, i) => (12 * i) / 6);
    const result = await previewMotionScene({
      code: compoundGrowthScene,
      format: "portrait",
      durationSeconds: 12,
      times,
      auditAt: times.slice(2),
    });
    assert.deepEqual(result.errors, []);
    assert.deepEqual(result.layout, []);
    assert(result.frames.slice(1, -1).every((f) => f.change! > 0.1));
  },
);
