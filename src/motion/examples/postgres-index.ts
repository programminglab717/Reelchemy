import type { MotionCode } from "../document";

// Showcase and reference example (15 s, landscape): how PostgreSQL uses a
// B-tree index to find one row. Written to the same contract the director
// follows, and used as a quality bar in its instructions.
export const postgresIndexScene: MotionCode = {
  html: `
<div class="bg"><div class="grid"></div><div class="orb o1"></div><div class="orb o2"></div></div>
<div class="eyebrow">HOW POSTGRES FINDS ONE ROW</div>
<div class="card query">
  <div class="card-head"><span class="dot r"></span><span class="dot y"></span><span class="dot g"></span><span class="tab">psql</span></div>
  <div class="sql"><div class="line"><span class="k">SELECT</span> * <span class="k">FROM</span> users</div><div class="line"><span class="k">WHERE</span> id = <span class="n">42</span>;</div></div>
  <div class="timing"><span class="t-label">Execution time</span><span class="t-value">0.000</span><span class="t-unit">ms</span></div>
</div>
<div class="planner"><div class="planner-icon"></div><div class="planner-label">Query planner</div><div class="planner-plan">Index Scan using users_pkey</div></div>
<svg class="wires" width="1920" height="1080" viewBox="0 0 1920 1080">
  <defs>
    <linearGradient id="wire" x1="0" x2="1"><stop offset="0" stop-color="#38bdf8"/><stop offset="1" stop-color="#a78bfa"/></linearGradient>
    <filter id="glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="6" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
  </defs>
  <path id="toPlanner" class="wire" d="M640 355 C 760 355, 740 250, 850 250"/>
  <path id="toRoot" class="wire" d="M1070 250 C 1170 250, 1200 178, 1338 178"/>
  <g class="tree">
    <path class="edge e1" d="M1420 205 L1260 330"/><path class="edge e2" d="M1420 205 L1420 330"/><path class="edge e3" d="M1420 205 L1580 330"/>
    <path class="edge e4" d="M1260 365 L1165 490"/><path class="edge e5" d="M1260 365 L1330 490"/>
    <path class="edge e6" d="M1580 365 L1650 490"/>
  </g>
  <path id="toHeap" class="wire hot" d="M1330 530 C 1330 640, 1060 640, 1010 760"/>
  <path id="back" class="wire back" d="M940 760 C 820 620, 700 560, 520 470"/>
  <circle class="packet p1" r="10" fill="#38bdf8" filter="url(#glow)"/>
  <circle class="packet p2" r="10" fill="#f472b6" filter="url(#glow)"/>
  <circle class="packet p3" r="12" fill="#fbbf24" filter="url(#glow)"/>
</svg>
<div class="node root" style="left:1340px;top:150px">1 … 100</div>
<div class="node n-a" style="left:1185px;top:310px">1 … 50</div>
<div class="node n-b" style="left:1345px;top:310px">51 … 75</div>
<div class="node n-c" style="left:1505px;top:310px">76 … 100</div>
<div class="node leaf l-a" style="left:1090px;top:470px">1 … 40</div>
<div class="node leaf l-b" style="left:1255px;top:470px">41 … 50</div>
<div class="node leaf l-c" style="left:1575px;top:470px">76 … 88</div>
<div class="tuple">42 → page 7, item 3</div>
<div class="tree-label">B-tree index · users_pkey</div>
<div class="heap">
  <div class="heap-label">Table heap · 10,000 pages</div>
  <div class="pages"></div>
</div>
<div class="row-card">
  <div class="row-head"><span>id</span><span>name</span><span>email</span></div>
  <div class="row-body"><span class="c1">42</span><span class="c2">Ada Lovelace</span><span class="c3">ada@analytical.io</span></div>
</div>
<div class="stat"><span class="big">3</span> page reads<span class="vs">instead of a 10,000-page scan</span></div>`,
  css: `
#stage{background:#070b18;color:#e2e8f0}
.bg{position:absolute;inset:0;overflow:hidden}
.grid{position:absolute;inset:-60px;background-image:linear-gradient(rgba(148,163,184,.07) 1px,transparent 1px),linear-gradient(90deg,rgba(148,163,184,.07) 1px,transparent 1px);background-size:60px 60px}
.orb{position:absolute;border-radius:50%;filter:blur(90px);opacity:.55}
.o1{width:700px;height:700px;left:-200px;top:-260px;background:#1d4ed8}
.o2{width:620px;height:620px;right:-180px;bottom:-240px;background:#7c3aed}
.eyebrow{position:absolute;left:120px;top:88px;font:600 26px "JetBrains Mono";letter-spacing:.32em;color:#7dd3fc}
.card{position:absolute;background:rgba(15,23,42,.85);border:1px solid rgba(148,163,184,.25);border-radius:22px;box-shadow:0 30px 80px rgba(0,0,0,.45)}
.query{left:120px;top:190px;width:520px;height:330px}
.card-head{height:52px;display:flex;align-items:center;gap:10px;padding:0 22px;border-bottom:1px solid rgba(148,163,184,.15)}
.dot{width:13px;height:13px;border-radius:50%}.r{background:#f87171}.y{background:#fbbf24}.g{background:#34d399}
.tab{margin-left:auto;font:500 22px "JetBrains Mono";color:#64748b}
.sql{margin:34px 34px 0;font:500 38px/1.55 "JetBrains Mono";color:#e2e8f0}
.line{white-space:nowrap}
.k{color:#c084fc}.n{color:#fbbf24}
.timing{position:absolute;left:30px;bottom:26px;display:flex;align-items:baseline;gap:12px;font-family:"JetBrains Mono"}
.t-label{font-size:21px;color:#64748b;text-transform:uppercase;letter-spacing:.12em}
.t-value{font-size:40px;font-weight:700;color:#34d399}.t-unit{font-size:22px;color:#34d399}
.planner{position:absolute;left:850px;top:180px;width:220px;height:140px;border-radius:20px;background:linear-gradient(160deg,#1e293b,#0f172a);border:1px solid #334155;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px}
.planner-icon{color:#38bdf8;height:52px}
.planner-label{font:600 24px "Space Grotesk";color:#cbd5e1}
.planner-plan{position:absolute;top:156px;width:380px;left:-80px;text-align:center;font:500 22px "JetBrains Mono";color:#a5b4fc}
.wire{fill:none;stroke:url(#wire);stroke-width:4;stroke-linecap:round;opacity:.9}
.wire.hot{stroke:#f472b6}.wire.back{stroke:#fbbf24;stroke-dasharray:2 14;stroke-width:5}
.edge{fill:none;stroke:#475569;stroke-width:3}
.node{position:absolute;width:160px;height:56px;margin-left:0;border-radius:14px;background:#111a2e;border:2px solid #334155;display:flex;align-items:center;justify-content:center;font:600 22px "JetBrains Mono";color:#94a3b8}
.node.leaf{width:150px}
.node.lit{border-color:#38bdf8;color:#e0f2fe;background:#0c4a6e;box-shadow:0 0 40px rgba(56,189,248,.45)}
.tuple{position:absolute;left:1150px;top:548px;padding:10px 18px;border-radius:12px;background:#3b0764;border:1px solid #a855f7;font:600 22px "JetBrains Mono";color:#f5d0fe}
.tree-label{position:absolute;left:1180px;top:84px;font:500 26px "Space Grotesk";color:#94a3b8}
.heap{position:absolute;left:640px;top:740px;width:1160px}
.heap-label{font:500 26px "Space Grotesk";color:#94a3b8;margin-bottom:16px}
.pages{display:grid;grid-template-columns:repeat(10,1fr);gap:14px}
.page{height:150px;border-radius:12px;background:#0f172a;border:1px solid #1e293b;padding:12px;display:flex;flex-direction:column;gap:9px}
.page .pn{font:600 21px "JetBrains Mono";color:#475569}
.page .ln{height:9px;border-radius:5px;background:#1e293b}
.page.hit{border-color:#f472b6;background:#2a0f2a;box-shadow:0 0 50px rgba(244,114,182,.45)}
.page.hit .pn{color:#f9a8d4}.page .ln.hit{background:#f472b6}
.row-card{position:absolute;left:120px;top:600px;width:440px;border-radius:18px;background:rgba(15,23,42,.92);border:1px solid #f472b6;overflow:hidden}
.row-head,.row-body{display:grid;grid-template-columns:70px 1fr 1.4fr;padding:14px 22px;font:500 20px "JetBrains Mono"}
.row-head{color:#64748b;background:rgba(244,114,182,.08)}
.row-body{color:#fdf2f8;font-size:21px}.c1{color:#fbbf24}
.stat{position:absolute;left:120px;top:880px;font:600 34px "Space Grotesk";color:#e2e8f0}
.stat .big{font-size:84px;color:#34d399;margin-right:14px;vertical-align:-8px}
.stat .vs{display:block;font:400 24px "Inter";color:#94a3b8;margin-top:4px}`,
  js: `
document.querySelector(".planner-icon").innerHTML = R.icon("cpu", { size: 52, color: "#38bdf8" });
const pages = document.querySelector(".pages");
for (let p = 1; p <= 10; p++) {
  const lines = Array.from({ length: 6 }, (_, i) => '<div class="ln' + (p === 7 && i === 2 ? ' hit-target' : '') + '" style="width:' + (55 + ((p * 7 + i * 13) % 40)) + '%"></div>').join("");
  pages.insertAdjacentHTML("beforeend", '<div class="page' + (p === 7 ? ' target' : '') + '"><div class="pn">p.' + p + '</div>' + lines + '</div>');
}
gsap.set([".packet"], { opacity: 0 });
const sqlChars = new SplitText(".sql .line", { type: "chars" }).chars;
const tl = gsap.timeline({ defaults: { ease: "power3.out" } });
// 0–1.6 s: set the scene, type the query.
tl.from(".grid", { opacity: 0, scale: 1.08, duration: 1.4, ease: "power2.out" }, 0)
  .from(".orb", { opacity: 0, scale: 0.6, duration: 2, stagger: 0.2 }, 0)
  .from(".eyebrow", { duration: 1, scrambleText: { text: "", chars: "01", speed: 0.6 } }, 0.1)
  .from(".query", { y: 60, opacity: 0, duration: 0.8 }, 0.2)
  .from(sqlChars, { opacity: 0, duration: 0.02, stagger: 0.025, ease: "none" }, 0.6)
// 1.7–3.3 s: the query travels to the planner, which chooses an index scan.
  .from("#toPlanner", { drawSVG: 0, duration: 0.6, ease: "power2.inOut" }, 1.7)
  .from(".planner", { scale: 0.6, opacity: 0, duration: 0.6, ease: "back.out(1.8)" }, 1.8)
  .set(".p1", { opacity: 1 }, 2.0)
  .to(".p1", { motionPath: { path: "#toPlanner", align: "#toPlanner", alignOrigin: [0.5, 0.5] }, duration: 0.7, ease: "power1.inOut" }, 2.0)
  .set(".p1", { opacity: 0 }, 2.7)
  .fromTo(".planner", { boxShadow: "0 0 0 rgba(56,189,248,0)" }, { boxShadow: "0 0 60px rgba(56,189,248,.6)", duration: 0.3, yoyo: true, repeat: 1 }, 2.7)
  .from(".planner-plan", { duration: 0.8, text: { value: "" }, ease: "none" }, 2.8)
// 3.4–5.4 s: the B-tree draws itself.
  .from(".tree-label", { opacity: 0, x: 30, duration: 0.6 }, 3.4)
  .from(".root", { scale: 0, duration: 0.5, ease: "back.out(2)" }, 3.5)
  .from(".tree .edge", { drawSVG: 0, duration: 0.5, stagger: 0.08, ease: "power2.inOut" }, 3.8)
  .from([".n-a", ".n-b", ".n-c"], { scale: 0, duration: 0.45, stagger: 0.1, ease: "back.out(2)" }, 4.1)
  .from([".l-a", ".l-b", ".l-c"], { scale: 0, duration: 0.45, stagger: 0.1, ease: "back.out(2)" }, 4.6)
// 5.5–8.0 s: the search walks root → internal → leaf.
  .from("#toRoot", { drawSVG: 0, duration: 0.5, ease: "power2.inOut" }, 5.5)
  .set(".p2", { opacity: 1 }, 5.7)
  .to(".p2", { motionPath: { path: "#toRoot", align: "#toRoot", alignOrigin: [0.5, 0.5] }, duration: 0.5, ease: "power1.in" }, 5.7)
  .set(".p2", { opacity: 0 }, 6.2)
  .add(() => {}, 6.2)
  .set(".root", { className: "node root lit" }, 6.2)
  .to(".e1", { stroke: "#38bdf8", strokeWidth: 5, duration: 0.3 }, 6.5)
  .set(".n-a", { className: "node n-a lit" }, 6.8)
  .to(".e5", { stroke: "#38bdf8", strokeWidth: 5, duration: 0.3 }, 7.1)
  .set(".l-b", { className: "node leaf l-b lit" }, 7.4)
  .from(".tuple", { y: -20, opacity: 0, duration: 0.5 }, 7.6)
// 8.0–10.6 s: jump straight to the right heap page and row.
  .from(".heap-label", { opacity: 0, y: 20, duration: 0.5 }, 7.9)
  .from(".page", { y: 40, opacity: 0, duration: 0.5, stagger: 0.04 }, 8.0)
  .from("#toHeap", { drawSVG: 0, duration: 0.7, ease: "power2.inOut" }, 8.6)
  .set(".page.target", { className: "page target hit" }, 9.3)
  .set(".page.target .hit-target", { className: "ln hit" }, 9.3)
  .fromTo(".page.target", { scale: 1 }, { scale: 1.12, duration: 0.35, yoyo: true, repeat: 1, ease: "power2.inOut" }, 9.3)
  .from(".row-card", { x: -60, opacity: 0, duration: 0.6 }, 9.8)
  .from(".row-body span", { duration: 0.5, text: { value: "" }, stagger: 0.15, ease: "none" }, 10.0)
// 10.8–13 s: the row comes back; the timing settles.
  .from("#back", { drawSVG: 0, duration: 0.8, ease: "power2.inOut" }, 10.8)
  .set(".p3", { opacity: 1 }, 11.0)
  .to(".p3", { motionPath: { path: "#back", align: "#back", alignOrigin: [0.5, 0.5] }, duration: 0.9, ease: "power2.inOut" }, 11.0)
  .set(".p3", { opacity: 0 }, 11.9)
  .fromTo(".t-value", { textContent: 0 }, { textContent: 0.042, duration: 0.8, ease: "power2.out", snap: { textContent: 0.001 }, onUpdate() { const el = document.querySelector(".t-value"); el.textContent = Number(el.textContent).toFixed(3); } }, 11.8)
  .fromTo(".query", { borderColor: "rgba(148,163,184,.25)" }, { borderColor: "#34d399", duration: 0.4 }, 11.9)
// 12.4–15 s: the takeaway.
  .from(".stat", { y: 30, opacity: 0, duration: 0.7 }, 12.4)
  .from(".stat .big", { textContent: 0, duration: 0.6, snap: { textContent: 1 } }, 12.5)
  .to(".grid", { y: 30, duration: 15, ease: "none" }, 0);`,
};
