import { test } from "node:test";
import assert from "node:assert/strict";
import { previewMotionScene } from "../src/motion/preflight";
import { cacheAsideScene } from "../src/motion/examples/cache-aside";
import { compoundGrowthScene } from "../src/motion/examples/compound-growth";
import { hero3dScene } from "../src/motion/examples/hero-3d";
import { cdnGlobeScene } from "../src/motion/examples/cdn-globe";
import { deployWalkthroughScene } from "../src/motion/examples/deploy-walkthrough";
import {
  auditTimes,
  coverageTimes,
  motionProbeTimes,
  reviewTimes,
  sceneProblems,
} from "../src/director/director";
import sharp from "sharp";

// A scene that checks the kit from inside: each check runs at a moment on the
// timeline and throws (reported as a scene error) when the kit misbehaves.
const selfChecking = {
  html: `<div class="world" style="position:absolute;inset:0"></div><div class="editor" style="position:absolute;left:200px;top:700px;width:900px"></div><div class="n" style="position:absolute;left:1300px;top:700px;font-size:60px">0</div>`,
  css: "",
  js: String.raw`
R.theme({ background: "#050816", accents: ["#38bdf8", "#f472b6"] });
R.finish({ grain: 0.06, vignette: 0.4 });
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

test(
  "3D scenes render with three.js: lit meshes, projection to the stage, drawn once per frame",
  { timeout: 120000 },
  async () => {
    const result = await previewMotionScene({
      code: {
        libraries: ["three"],
        html: "",
        css: "",
        js: String.raw`
const check = (ok, message) => { if (!ok) throw new Error("CHECK " + message); };
const view = R.three({ camera: [0, 0, 8], target: [0, 0, 0], background: "#000000", environment: true });
const ball = view.sphere({ r: 1, color: "#ffffff", emissive: "#ff2020", emissiveIntensity: 2 });
const logo = view.extrude("M0 0 H100 V100 H0 Z M30 30 V70 H70 V30 Z", { size: 1, position: [3, 0, 0] });
const card = view.label("Hello", { size: 48, position: [-3, 0, 0] });
const centre = view.screen([0, 0, 0]);
check(Math.abs(centre.x - 960) < 1 && Math.abs(centre.y - 540) < 1, "the target projects to the stage centre: " + JSON.stringify(centre));
check(view.screen(logo).x > 1200, "objects to the right project right of centre");
check(window.__reelchemyDraw.length === 1, "one draw hook is registered");
check(logo.geometry.attributes.position.count > 0 && card.material.map, "meshes are built");
gsap.to(ball.position, { x: 2.5, duration: 2, ease: "none" });
`,
      },
      format: "landscape",
      durationSeconds: 2,
      times: [0, 2],
      width: 480,
    });
    assert.deepEqual(result.errors, []);
    // The emissive ball is drawn: red at the centre at 0 s, then it moves right.
    const pixel = async (png: Buffer, x: number, y: number) => [
      ...(await sharp(png)
        .extract({ left: x, top: y, width: 1, height: 1 })
        .raw()
        .toBuffer()),
    ];
    const [r0, g0] = await pixel(result.frames[0].png, 240, 135);
    assert(r0 > 150 && g0 < r0, `centre at 0 s: ${r0},${g0}`);
    const [r1] = await pixel(result.frames[1].png, 240, 135);
    assert(r1 < r0, "the ball has moved away from the centre");
    assert(result.frames[1].change! > 1);
  },
);

test(
  "the 3D reference scene meets its own checks",
  { timeout: 180000 },
  async () => {
    const times = [0.6, 2.6, 4.5, 6.5, 9.5];
    const result = await previewMotionScene({
      code: hero3dScene,
      format: "landscape",
      durationSeconds: 10,
      times,
      auditAt: times.slice(1),
    });
    assert.deepEqual(result.errors, []);
    assert.deepEqual(result.layout, []);
    assert(result.frames.every((f) => f.detail > 8));
  },
);

test(
  "project images reach code scenes as local URLs, in HTML and in 3D",
  { timeout: 120000 },
  async () => {
    const id = "0b5c3a54-6a4f-4d3e-9f3e-2f1d9a6c7b10";
    const png = await sharp({
      create: { width: 200, height: 100, channels: 3, background: "#ff0000" },
    })
      .png()
      .toBuffer();
    const result = await previewMotionScene({
      code: {
        assets: [id],
        libraries: ["three"],
        html: `<img class="a" data-asset="${id}" style="position:absolute;left:0;top:0;width:400px;height:200px">`,
        css: "#stage{background:#000}",
        js: String.raw`
const check = (ok, message) => { if (!ok) throw new Error("CHECK " + message); };
check(R.asset("${id}").startsWith("blob:"), "assets are local blob URLs");
check(document.querySelector(".a").complete && document.querySelector(".a").naturalWidth === 200, "data-asset images are loaded before scene code runs");
const img = R.image("${id}", { style: { position: "absolute", left: 1520, top: 0, width: 400, height: 200 } });
check(img.tagName === "IMG", "R.image makes an image element");
const view = R.three({ camera: [0, 0, 6], environment: false, background: "#000000" });
view.image("${id}", { width: 2 });
let refused = false;
try { R.asset("11111111-1111-4111-8111-111111111111"); } catch { refused = true; }
check(refused, "undeclared images are refused");
`,
      },
      assets: { [id]: { bytes: png, type: "image/png" } },
      format: "landscape",
      durationSeconds: 1,
      times: [0.5],
      width: 960,
    });
    assert.deepEqual(result.errors, []);
    const at = async (x: number, y: number) => [
      ...(await sharp(result.frames[0].png)
        .extract({ left: x, top: y, width: 1, height: 1 })
        .raw()
        .toBuffer()),
    ];
    // Top-left HTML image, top-right R.image, centre 3D picture: all red.
    for (const [x, y] of [
      [100, 50],
      [860, 50],
      [480, 270],
    ]) {
      const [r, g, b] = await at(x, y);
      assert(r > 180 && g < 60 && b < 60, `${x},${y}: ${r},${g},${b}`);
    }
  },
);

// The explainer blocks, checked from inside a scene at moments on its timeline.
const explainerChecks = {
  html: '<section class="shot s1"><h1 class="t" style="position:absolute;left:120px;top:100px;margin:0;font:700 80px Inter;color:#fff">Edge <span class="w">fast</span></h1></section><section class="shot s2"></section>',
  css: ".shot{position:absolute;inset:0}",
  js: String.raw`
const check = (ok, message) => { if (!ok) throw new Error("CHECK " + message); };
const near = (a, b, t) => Math.abs(a - b) <= (t || 3);
const a = R.node({ parent: ".s1", x: 400, y: 600, w: 300, label: "A" });
const b = R.node({ parent: ".s1", x: 1400, y: 600, w: 300, label: "B" });
const arrow = R.arrow(a, b, { label: "GET /" });
const note = R.callout(b, { title: "Hit", text: "18 ms", side: "top", distance: 80 });
const steps = R.steps({ parent: ".s2", x: 200, y: 300, items: ["One", "Two", "Three"] });
const win = R.window({ parent: ".s2", kind: "browser", x: 1200, y: 540, w: 900, h: 600, url: "" });
win.body.innerHTML = '<div class="btn" style="position:absolute;left:300px;top:300px;width:200px;height:60px;background:#38bdf8"></div>';
const cursor = R.cursor({ parent: ".s2", x: 1700, y: 1000 });
const chart = R.chart({ parent: ".s2", x: 200, y: 700, w: 600, h: 200, data: [0, 50, 100], suffix: "%" });
const stat = R.stat({ parent: ".s2", x: 1600, y: 200, value: 42, label: "requests" });
const tl = gsap.timeline();
tl.add(arrow.draw({ duration: 0.6 }), 0.2).add(note.show(), 0.4).add(R.swap(".w", ["fast", "cheap"], { every: 0.8 }), 0)
  .add(steps.reveal(), 1.6).add(steps.activate(1), 1.8).add(cursor.moveTo(".btn", { duration: 0.5 }), 1.6).add(chart.draw({ duration: 0.5 }), 1.6).add(stat.show({ duration: 0.4 }), 1.6)
  .add(R.shots([".s1", ".s2"], { at: [0, 1.4], transition: "push", duration: 0.4 }), 0);
tl.call(() => {
  // On screen (R.box ignores the label's centring transform).
  const mid = arrow.pointAt(0.5), r = arrow.label.getBoundingClientRect(), st = R.stage.getBoundingClientRect(), k = st.width / R.width;
  check(near((r.left - st.left + r.width / 2) / k, mid.x, 4) && near((r.top - st.top + r.height / 2) / k, mid.y, 4), "the arrow label rides the middle of its path");
  const n = R.box(note.element), bb = R.box(b);
  check(n.y + n.h <= bb.y, "the callout sits above its target");
  check(getComputedStyle(document.querySelector(".s2")).visibility === "hidden", "the second shot waits for its cut");
  check(document.querySelector(".w").textContent.includes("fast"), "the swap starts on the first word");
}, [], 1.0)
  .call(() => {
    check(getComputedStyle(document.querySelector(".s1")).visibility === "hidden", "the first shot is gone after the transition");
    check(getComputedStyle(document.querySelector(".s2")).visibility === "visible", "the second shot is on screen");
    const rows = document.querySelectorAll(".r-step");
    check(rows.length === 3 && getComputedStyle(rows[1]).getPropertyValue("--r-on").trim() === "1", "step two is lit");
    const c = R.box(cursor.element), btn = R.box(".btn", ".s2");
    check(near(c.x, btn.x + btn.w * 0.5, 6) && near(c.y, btn.y + btn.h * 0.55, 6), "the cursor reached the button: " + JSON.stringify([c, btn]));
    check(document.querySelector(".r-chart-value").textContent === "100%", "the chart tip lands on the last value");
    check(document.querySelector(".r-stat-value").textContent === "42", "the stat counts to its value");
  }, [], 2.4);
`,
};

test(
  "explainer blocks: labelled arrows, callouts, shots, steps, cursor, charts and stats",
  { timeout: 120000 },
  async () => {
    const result = await previewMotionScene({
      code: explainerChecks,
      format: "landscape",
      durationSeconds: 2.5,
      times: [0, 1, 2.5],
      width: 480,
    });
    assert.deepEqual(result.errors, []);
  },
);

for (const [name, code, seconds] of [
  ["the multi-shot CDN reference", cdnGlobeScene, 15],
  ["the software tutorial reference", deployWalkthroughScene, 12],
] as const)
  test(
    `${name} passes the director's own checks: no errors, frozen stretches, empty frames or layout notes`,
    { timeout: 240000 },
    async () => {
      // The same moments the director looks at.
      const times = reviewTimes(seconds);
      const result = await previewMotionScene({
        code,
        format: "landscape",
        durationSeconds: seconds,
        times,
        probeTimes: motionProbeTimes(seconds),
        coverageAt: coverageTimes(seconds),
        auditAt: auditTimes(seconds, times),
        timeoutMs: 200000,
      });
      assert.deepEqual(
        sceneProblems(result, seconds, {
          threeD: !!code.libraries?.includes("three"),
        }),
        [],
      );
    },
  );

// Options added after a fresh model wrote a scene from the guide alone and
// reported what it had to guess: caption lines, hiding arrows, sub text that
// follows the label size, and big stat cards.
const guideGapChecks = {
  html: '<div class="world" style="position:absolute;inset:0"></div><div class="cap" style="position:absolute;left:120px;top:900px;width:1200px;font:500 40px Inter;color:#e2e8f0"></div>',
  css: "",
  js: String.raw`R.theme({background:'#050816'});
const check=(ok,m)=>{if(!ok)throw new Error('CHECK '+m)};
const w=document.querySelector('.world');
const a=R.node({parent:w,x:420,y:400,label:'Load balancer',sub:'Service',icon:'network',fontSize:42,iconSize:64});
const b=R.node({parent:w,x:1400,y:400,label:'web-v2',sub:'image v2',icon:'box',fontSize:42,iconSize:64});
const sub=a.querySelector('.r-sub');check(Math.abs(parseFloat(getComputedStyle(sub).fontSize)-29.4)<0.6,'sub scales with fontSize: '+getComputedStyle(sub).fontSize);
const link=R.arrow(a,b,{label:'12.4k req/s'});
const st=R.stat({parent:w,x:960,y:700,value:0,from:37,label:'failed requests',size:160});
check(st.element.offsetHeight>240,'big stat card: '+st.element.offsetHeight);
const tl=gsap.timeline();
tl.add(link.draw({duration:0.5}),0.2).add(st.show({duration:0.8}),0.3).add(R.captions('.cap',[[0,'1 · Start one new pod'],[1,'2 · Wait until it is Ready'],[2,'3 · Remove one old pod']]),0.5).add(link.hide(),2.6);
const shown=()=>[...document.querySelectorAll('.r-caption-line')].filter(n=>getComputedStyle(n).visibility==='visible'&&Number(getComputedStyle(n).opacity)>0.9).map(n=>n.textContent);
tl.call(()=>{check(shown().join('|')==='1 · Start one new pod','first caption: '+shown().join('|'));check(Number(getComputedStyle(link.group).opacity)===1,'arrow visible')},[],1.2)
.call(()=>{check(shown().join('|')==='2 · Wait until it is Ready','second caption: '+shown().join('|'));check(st.value.textContent==='0','stat counted down to 0: '+st.value.textContent)},[],2.2)
.call(()=>{check(shown().join('|')==='3 · Remove one old pod','third caption: '+shown().join('|'));check(Number(getComputedStyle(link.group).opacity)===0&&Number(getComputedStyle(link.label).opacity)===0,'arrow and label hidden')},[],3.4);`,
};

test(
  "captions swap in place, arrows hide with their labels, sub text and stat cards scale",
  { timeout: 120000 },
  async () => {
    const result = await previewMotionScene({
      code: guideGapChecks,
      format: "landscape",
      durationSeconds: 3.5,
      times: [0.5, 3.4],
      width: 480,
    });
    assert.deepEqual(result.errors, []);
    assert.deepEqual(result.layout, []);
  },
);
