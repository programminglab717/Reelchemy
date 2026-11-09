import type { MotionCode } from "../document";

// Reference example (15 s, landscape, three shots): a dense, high-end
// explainer. Shot 1: a 3D globe with traffic arcs and headline stats. Shot 2:
// a request diagram that builds step by step with labelled arrows, callouts
// and a camera move. Shot 3: the payoff with a drawn chart and stat cards.
// Something new happens every 1–2 seconds; every shot fills the frame.
export const cdnGlobeScene: MotionCode = {
  libraries: ["three"],
  html: `
<section class="shot s1">
  <div class="eyebrow">CONTENT DELIVERY NETWORK</div>
  <h1 class="h1">Every visitor, <span class="hl">20 ms</span> from your site</h1>
  <div class="stats1"></div>
</section>
<section class="shot s2">
  <div class="eyebrow">ONE REQUEST, STEP BY STEP</div>
  <div class="world"></div>
</section>
<section class="shot s3">
  <div class="eyebrow">THE RESULT</div>
  <h2 class="h2">Faster for users.<br><span class="hl">Lighter</span> on your origin.</h2>
</section>`,
  css: `
.shot{position:absolute;inset:0}
.eyebrow{position:absolute;left:120px;top:96px;font:600 26px var(--r-mono);letter-spacing:.36em;color:var(--r-accent)}
.h1{position:absolute;left:120px;top:150px;width:860px;margin:0;font:700 96px/1.04 var(--r-display);letter-spacing:-.035em;color:#f8fafc}
.h2{position:absolute;left:120px;top:150px;margin:0;font:700 84px/1.05 var(--r-display);letter-spacing:-.03em;color:#f8fafc}
.hl{color:var(--r-accent);white-space:nowrap}
.world{position:absolute;inset:0}`,
  js: `
R.theme({ background: "#030611", surface: "#0c1428", accents: ["#38bdf8", "#a78bfa", "#34d399", "#f472b6"] });
R.finish({ grain: 0.035, vignette: 0.5 });
const tl = gsap.timeline({ defaults: { ease: "power3.out" } });

// ---------- Shot 1 (0–5 s): the network around the globe.
const view = R.three({ parent: ".s1", camera: [0, 0.2, 9.6], target: [1.7, 0, 0], bloom: { strength: 0.75 } });
view.particles({ count: 500, spread: [34, 18, 22], size: 0.03, color: "#93c5fd", opacity: 0.6 });
const globe = view.globe({ r: 2.6, position: [3.7, -0.75, 0], color: "#7dd3fc" });
const origin = [38.9, -77.0];
const pops = [[51.5, -0.1], [50.1, 8.7], [48.9, 2.3], [40.4, -3.7], [59.3, 18.1], [41.0, 28.9], [25.2, 55.3], [19.1, 72.9], [1.35, 103.8], [35.7, 139.7], [-23.5, -46.6], [19.4, -99.1], [37.8, -122.4], [43.7, -79.4]];
globe.face([18, -25]);
globe.pin(origin, { color: "#f472b6", size: 0.09 });
tl.add(globe.spin({ turns: -0.05, duration: 5 }), 0);
pops.forEach((p, i) => {
  globe.pin(p, { color: "#a78bfa", size: 0.05 });
  const arc = globe.arc(origin, p, { color: i % 3 === 0 ? "#a78bfa" : "#38bdf8", height: 0.16 });
  tl.add(arc.draw({ duration: 0.9 }), 0.6 + i * 0.12).add(arc.flow({ count: 2, duration: 1.1 }), 1.5 + i * 0.12);
});
tl.from(".s1 .eyebrow", { duration: 0.9, scrambleText: { text: "", chars: "01", speed: 0.6 } }, 0.1)
  .add(R.headline(".h1", { by: "words", style: "rise" }), 0.25);
const s1 = document.querySelector(".stats1");
const cities = R.stat({ parent: s1, x: 120, y: 700, anchor: "top-left", value: 330, suffix: "+", label: "cities with a server" });
const median = R.stat({ parent: s1, x: 540, y: 700, anchor: "top-left", value: 20, suffix: " ms", label: "median to a visitor", color: "#34d399" });
tl.add(cities.show({ duration: 1.4 }), 1.6).add(median.show({ duration: 1.4 }), 2.0)
  .add(R.mark(".h1 .hl", { style: "underline", color: "#38bdf8" }).draw({ duration: 0.5 }), 2.6);

// ---------- Shot 2 (5–10 s): how one request is served.
const world = document.querySelector(".world");
const user = R.node({ parent: world, x: 320, y: 470, w: 360, label: "Visitor", sub: "Lisbon", icon: "smartphone", column: true, fontSize: 38, iconSize: 72 });
const edge = R.node({ parent: world, x: 960, y: 470, w: 420, label: "Edge server", sub: "Madrid · 4 ms away", icon: "zap", column: true, color: "#38bdf8", fontSize: 38, iconSize: 72 });
const originNode = R.node({ parent: world, x: 1580, y: 470, w: 360, label: "Origin", sub: "Virginia", icon: "server", column: true, color: "#f472b6", fontSize: 38, iconSize: 72 });
const toEdge = R.arrow(user, edge, { label: "GET /index.html" });
const toOrigin = R.arrow(edge, originNode, { label: "only on a miss", color: "#f472b6", dash: "6 12" });
const hit = R.callout(edge, { title: "Cache HIT", text: "Served from memory in 18 ms", side: "bottom-left", distance: 70, color: "#34d399" });
const why = R.callout(originNode, { title: "6,000 km away", text: "120 ms per round trip", side: "bottom", distance: 70, color: "#f472b6" });
const latency = R.bars({ parent: world, x: 120, y: 800, w: 1680, h: 190, horizontal: true, labelWidth: 260, data: [{ label: "From the edge", value: 18, color: "#34d399" }, { label: "From the origin", value: 140, color: "#f472b6" }], suffix: " ms" });
tl.from([user, edge, originNode], { opacity: 0, y: 60, scale: 0.85, duration: 0.7, stagger: 0.15, ease: "back.out(1.6)" }, 5.25)
  .from(".s2 .eyebrow", { opacity: 0, x: -30, duration: 0.6 }, 5.2)
  .add(why.show(), 5.9)
  .add(toEdge.draw({ duration: 0.8 }), 6.3)
  .add(R.flow(toEdge, { count: 3, duration: 0.7, every: 0.3 }), 6.9)
  .add(R.focus(world, edge, { scale: 1.35, at: [960, 500], duration: 1.2 }), 7.3)
  .to(edge, { "--r-accent": "#34d399", duration: 0.3 }, 7.9)
  .add(R.pulse(edge, { scale: 1.08, glow: "rgba(52,211,153,.6)" }), 7.9)
  .add(hit.show(), 8.1)
  .add(R.focus(world, null, { duration: 1 }), 8.9)
  .add(toOrigin.draw({ duration: 0.8 }), 8.7)
  .add(latency.grow({ duration: 0.9 }), 9.0);

// ---------- Shot 3 (10–15 s): the payoff.
const chart = R.chart({ parent: ".s3", x: 120, y: 470, w: 1040, h: 420, kind: "area", data: [41, 48, 57, 66, 74, 83, 89, 94], labels: ["W1", "W2", "W3", "W4", "W5", "W6", "W7", "W8"], suffix: "%", color: "#38bdf8" });
const faster = R.stat({ parent: ".s3", x: 1560, y: 420, value: 4.1, decimals: 1, suffix: "×", label: "faster page loads", color: "#34d399" });
const lighter = R.stat({ parent: ".s3", x: 1560, y: 690, value: 83, prefix: "−", suffix: "%", label: "requests reaching the origin", color: "#a78bfa" });
const caption = R.el("div", { parent: ".s3", text: "Cache hit ratio", style: { left: 120, top: 400, font: "500 28px var(--r-body)", color: "var(--r-muted)" } });
tl.from(".s3 .eyebrow", { opacity: 0, x: -30, duration: 0.6 }, 10.3)
  .add(R.headline(".h2", { by: "lines", style: "rise" }), 10.3)
  .from(caption, { opacity: 0, duration: 0.5 }, 10.8)
  .add(chart.draw({ duration: 2.4 }), 10.9)
  .add(faster.show(), 11.6)
  .add(lighter.show(), 12.2)
  .add(R.mark(".h2 .hl", { style: "marker" }).draw(), 12.9)
  .add(R.drift(".s3", { scale: 1.03 }), 10);

tl.add(R.shots([".s1", ".s2", ".s3"], { at: [0, 5, 10], transition: ["zoom", "push"] }), 0);`,
};
