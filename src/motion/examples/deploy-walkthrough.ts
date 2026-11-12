import type { MotionCode } from "../document";

// Reference example (12 s, landscape, two shots): a software tutorial.
// Shot 1: an app window where a cursor creates a project, with callouts and
// a step list that advances with each click. Shot 2 (wipe): a terminal that
// types the deploy command, a progress bar, output lines and the live URL.
export const deployWalkthroughScene: MotionCode = {
  html: `
<section class="shot s1">
  <div class="eyebrow">TUTORIAL · 1 OF 2</div>
  <h1 class="title">Deploy your app in <span class="hl">two minutes</span></h1>
</section>
<section class="shot s2">
  <div class="eyebrow">TUTORIAL · 2 OF 2</div>
  <h1 class="title">Ship it from the terminal</h1>
</section>`,
  css: `
.shot{position:absolute;inset:0}
.eyebrow{position:absolute;left:120px;top:86px;font:600 24px var(--r-mono);letter-spacing:.32em;color:var(--r-accent)}
.title{position:absolute;left:120px;top:128px;margin:0;font:700 76px var(--r-display);letter-spacing:-.03em;color:#f8fafc;white-space:nowrap}
.hl{color:var(--r-accent)}
.side{position:absolute;left:0;top:0;bottom:0;width:250px;padding:28px 22px;background:rgba(255,255,255,.03);border-right:1px solid rgba(255,255,255,.07);display:flex;flex-direction:column;gap:14px}
.side .item{display:flex;align-items:center;gap:14px;height:52px;padding:0 16px;border-radius:12px;font:500 24px var(--r-body);color:var(--r-muted)}
.side .item.on{background:rgba(56,189,248,.12);color:var(--r-text)}
.main{position:absolute;left:250px;top:0;right:0;bottom:0;padding:36px 44px}
.main h3{display:inline-block;margin:0 0 26px;font:600 34px var(--r-display);color:var(--r-text)}
.cards{display:grid;grid-template-columns:repeat(2,1fr);gap:22px}
.card{height:150px;border-radius:18px;background:rgba(255,255,255,.04);border:1.5px solid rgba(255,255,255,.08);padding:22px;display:flex;flex-direction:column;justify-content:space-between}
.card b{font:600 28px var(--r-display);color:var(--r-text)}
.card span{font:500 22px var(--r-mono);color:var(--r-muted)}
.new{position:absolute;right:44px;top:30px;display:flex;align-items:center;gap:12px;padding:16px 28px;border-radius:14px;background:var(--r-accent);color:#04111d;font:700 26px var(--r-body)}
.scrim{position:absolute;inset:0;background:rgba(3,7,18,.6)}
.form{position:absolute;left:300px;top:170px;width:560px;padding:30px;border-radius:20px;background:#111b33;border:1.5px solid rgba(56,189,248,.4);box-shadow:0 30px 80px rgba(0,0,0,.5)}
.form label{display:block;font:500 22px var(--r-body);color:var(--r-muted);margin-bottom:10px}
.form .field{height:60px;border-radius:12px;background:rgba(255,255,255,.05);border:1.5px solid rgba(255,255,255,.12);padding:0 18px;display:flex;align-items:center;font:500 26px var(--r-mono);color:var(--r-text);margin-bottom:24px}
.form .go{display:inline-flex;padding:14px 30px;border-radius:12px;background:#34d399;color:#03140d;font:700 26px var(--r-body)}
.bar{position:absolute;left:32px;right:32px;bottom:56px;height:16px;border-radius:8px;background:rgba(255,255,255,.08);overflow:hidden}
.bar i{position:absolute;inset:0;border-radius:8px;background:linear-gradient(90deg,#38bdf8,#34d399);transform-origin:0 50%}
.out{margin-top:30px;display:flex;flex-direction:column;gap:14px;font:500 32px var(--r-mono)}
.out .ok{color:#34d399}.out .url{color:#7dd3fc}`,
  js: `
R.theme({ background: "#050914", surface: "#0d1528", accents: ["#38bdf8", "#34d399", "#a78bfa", "#f472b6"] });
R.finish({ grain: 0.03, vignette: 0.4 });
R.glow({ x: 1500, y: 200, size: 900, color: "#1d4ed8", opacity: 0.25 });
const tl = gsap.timeline({ defaults: { ease: "power3.out" } });

// ---------- Shot 1 (0–6.6 s): create the project in the dashboard.
const app = R.window({ parent: ".s1", kind: "app", title: "Cloud dashboard", x: 720, y: 640, w: 1200, h: 720 });
app.body.innerHTML = '<div class="side"><div class="item on">' + R.icon("layout-grid", { size: 26 }) + 'Projects</div><div class="item">' + R.icon("globe", { size: 26 }) + 'Domains</div><div class="item">' + R.icon("chart-line", { size: 26 }) + 'Analytics</div><div class="item">' + R.icon("settings", { size: 26 }) + 'Settings</div></div>' +
  '<div class="main"><h3>Projects</h3><div class="new">' + R.icon("rocket", { size: 26, color: "#04111d" }) + 'New project</div><div class="cards"><div class="card"><b>marketing-site</b><span>Ready · 2 d ago</span></div><div class="card"><b>docs</b><span>Ready · 5 h ago</span></div><div class="card"><b>api-gateway</b><span>Ready · 1 w ago</span></div><div class="card"><b>status-page</b><span>Ready · 3 w ago</span></div></div></div>' +
  '<div class="scrim"></div><div class="form"><label>Repository</label><div class="field repo"></div><label>Branch</label><div class="field branch">main</div><div class="go">Deploy</div></div>';
const steps = R.steps({ parent: ".s1", x: 1400, y: 330, items: [{ title: "New project", sub: "from the dashboard" }, { title: "Pick a repo", sub: "GitHub · main" }, { title: "Deploy", sub: "builds in the cloud" }] });
const cursor = R.cursor({ parent: ".s1", x: 1250, y: 980 });
const tipNew = R.callout(".s1 .new", { title: "Step 1", text: "Start a new project", side: "left", distance: 50 });
tl.from(".s1 .eyebrow", { opacity: 0, x: -30, duration: 0.5 }, 0.1)
  .add(R.headline(".s1 .title", { by: "words", style: "rise" }), 0.15)
  .add(app.open(), 0.4)
  .from(".s1 .card", { opacity: 0, y: 30, duration: 0.5, stagger: 0.08 }, 0.9)
  .set(".s1 .form, .s1 .scrim", { autoAlpha: 0 }, 0)
  .add(steps.reveal(), 1.0)
  .add(steps.activate(0), 1.6)
  .add(tipNew.show(), 1.7)
  .add(cursor.moveTo(".s1 .new", { duration: 1 }), 1.9)
  .add(cursor.click(), 2.95)
  .add(tipNew.hide(), 3.1)
  .to(".s1 .scrim", { autoAlpha: 1, duration: 0.4 }, 3.1)
  .fromTo(".s1 .form", { autoAlpha: 0, y: 30, scale: 0.96 }, { autoAlpha: 1, y: 0, scale: 1, duration: 0.5 }, 3.15)
  .add(steps.activate(1), 3.3)
  .to(".s1 .repo", { duration: 0.9, text: { value: "acme/storefront" }, ease: "none" }, 3.5)
  .add(R.mark(".s1 .repo", { style: "box", color: "#a78bfa" }).draw({ duration: 0.5 }), 4.5)
  .add(cursor.moveTo(".s1 .go", { duration: 0.8 }), 4.6)
  .add(cursor.click({ color: "#34d399" }), 5.5)
  .add(steps.activate(2), 5.6)
  .add(R.pulse(".s1 .go", { scale: 1.1, glow: "rgba(52,211,153,.7)" }), 5.6);

// ---------- Shot 2 (6.6–12 s): the same deploy from the terminal.
const term = R.window({ parent: ".s2", kind: "terminal", title: "~/storefront", x: 820, y: 650, w: 1300, h: 640 });
term.body.innerHTML = '<div class="cmd"></div><div class="out"></div><div class="bar"><i></i></div>';
const cmd = R.code(term.body.querySelector(".cmd"), "$ npx cloud deploy --prod", { lang: "bash", fontSize: 34 });
const out = term.body.querySelector(".out");
const lines = [["ok", "✓ Installed dependencies (412 packages)"], ["ok", "✓ Built 38 pages in 9.2 s"], ["ok", "✓ Uploaded to 35 regions"], ["url", "→ https://storefront.acme.app"]].map(([kind, text]) => R.el("div", { parent: out, className: kind, text }));
const live = R.stat({ parent: ".s2", x: 1690, y: 560, value: 38, suffix: " s", label: "from push to live", color: "#34d399" });
tl.from(".s2 .eyebrow", { opacity: 0, x: -30, duration: 0.5 }, 6.8)
  .add(R.headline(".s2 .title", { by: "chars", style: "rise" }), 6.8)
  .add(term.open(), 6.9)
  .add(cmd.type({ duration: 1.1 }), 7.4)
  .from(".s2 .bar i", { scaleX: 0, duration: 2.4, ease: "power1.inOut" }, 8.6)
  .from(lines, { opacity: 0, x: -20, duration: 0.4, stagger: 0.6 }, 8.8)
  .add(live.show({ duration: 1.2 }), 10.4)
  .add(R.mark(lines[3], { style: "underline", color: "#7dd3fc" }).draw({ duration: 0.5 }), 11.1)
  .add(R.drift(".s2", { scale: 1.03 }), 6.6);

tl.add(R.shots([".s1", ".s2"], { at: [0, 6.6], transition: "wipe" }), 0);`,
};
