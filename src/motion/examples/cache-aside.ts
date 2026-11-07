import type { MotionCode } from "../document";

// Reference example (14 s, landscape) written with the kit's primitives:
// a cache miss and a cache hit with Redis in front of PostgreSQL.
export const cacheAsideScene: MotionCode = {
  html: `
<div class="eyebrow">CACHE-ASIDE PATTERN</div>
<h1 class="headline">Why the second request is <em>40×</em> faster</h1>
<div class="world"></div>
<div class="legend">
  <div class="req r1"><span class="tag">Request 1</span><span class="verdict miss">MISS</span><span class="ms m1">0.0 ms</span></div>
  <div class="req r2"><span class="tag">Request 2</span><span class="verdict hit">HIT</span><span class="ms m2">0.0 ms</span></div>
</div>
<div class="editor"><div class="code"></div></div>`,
  css: `
.eyebrow{position:absolute;left:120px;top:84px;font:600 26px var(--r-mono);letter-spacing:.3em;color:var(--r-accent-1)}
.headline{position:absolute;left:120px;top:124px;margin:0;font:700 68px var(--r-display);letter-spacing:-.01em}
.headline em{font-style:normal;color:var(--r-accent-4)}
.world{position:absolute;inset:0}
.legend{position:absolute;left:120px;top:820px;display:flex;flex-direction:column;gap:18px}
.req{display:flex;align-items:center;gap:22px;font:600 30px var(--r-display)}
.tag{width:190px;color:var(--r-muted)}
.verdict{width:110px;padding:6px 0;text-align:center;border-radius:10px;font:700 24px var(--r-mono);letter-spacing:.12em}
.miss{background:rgba(244,114,182,.16);color:#f9a8d4;border:1px solid #f472b6}
.hit{background:rgba(52,211,153,.16);color:#6ee7b7;border:1px solid #34d399}
.ms{font:700 40px var(--r-mono)}.m1{color:#f9a8d4}.m2{color:#6ee7b7}
.editor{position:absolute;left:1010px;top:790px;width:790px;padding:26px 30px;border-radius:22px;background:rgba(14,21,40,.9);border:1px solid #23304d}
.code{font-size:26px}`,
  js: `
R.theme({ background: "#060a16", surface: "#0e1528", text: "#e2e8f0", muted: "#8b9bb4",
  accents: ["#38bdf8", "#a78bfa", "#f472b6", "#34d399"] });
R.grid({ drift: true });
R.glow({ x: 260, y: 160, size: 820, color: "#1d4ed8", opacity: 0.38 });
R.glow({ x: 1680, y: 940, size: 760, color: "#6d28d9", opacity: 0.32 });
R.particles({ count: 34 });

// Diagram: the app in front, Redis above the database path.
const world = document.querySelector(".world");
const app = R.node({ parent: world, x: 330, y: 500, label: "App server", sub: "GET /users/42", icon: "server" });
const redis = R.node({ parent: world, x: 1000, y: 380, label: "Redis", sub: "in-memory", icon: "zap", color: "#f472b6" });
const pg = R.node({ parent: world, x: 1590, y: 560, label: "PostgreSQL", sub: "on disk", icon: "database", color: "#a78bfa" });
const toRedis = R.connect(app, redis, { from: "right", to: "left", glow: true });
const toPg = R.connect(app, pg, { from: "right", to: "left", color: "#a78bfa", glow: true, tension: 0.35 });
const fill = R.connect(pg, redis, { from: "top", to: "right", color: "#34d399", dash: "3 12", arrow: true });
const code = R.code(".code", "const user = await redis.get(key)\\n  ?? await cacheFill(db.query(sql, [42]));", { lang: "js" });

const tl = gsap.timeline({ defaults: { ease: "power3.out" } });
// 0–1.6 s: headline and the three parts of the system.
tl.from(".eyebrow", { duration: 0.9, scrambleText: { text: "", chars: "01", speed: 0.5 } }, 0)
  .from(new SplitText(".headline", { type: "words" }).words, { y: 40, opacity: 0, duration: 0.7, stagger: 0.06 }, 0.15)
  .from([app, redis, pg], { scale: 0.7, opacity: 0, duration: 0.6, stagger: 0.14, ease: "back.out(1.7)" }, 0.6)
// 1.6–3.4 s: request 1 asks Redis first — a miss.
  .from(".r1", { opacity: 0, x: -30, duration: 0.5 }, 1.5)
  .add(toRedis.draw({ duration: 0.6 }), 1.6)
  .add(R.flow(toRedis, { count: 1, duration: 0.7, size: 11 }), 2.1)
  .from(".r1 .miss", { scale: 0, duration: 0.4, ease: "back.out(2.5)" }, 2.8)
  .to(redis, { x: 8, duration: 0.06, repeat: 5, yoyo: true, ease: "none" }, 2.8)
// 3.4–6.4 s: fall back to PostgreSQL (slow), then fill the cache.
  .add(toPg.draw({ duration: 0.7 }), 3.4)
  .add(R.flow(toPg, { count: 1, duration: 1.4, size: 11, ease: "sine.inOut" }), 3.9)
  .add(R.ring(pg, { color: "#a78bfa" }).draw({ duration: 0.6 }), 5.1)
  .add(R.count(".m1", 48, { decimals: 1, suffix: " ms", duration: 2.2, ease: "power1.in" }), 3.9)
  .add(fill.draw({ duration: 0.8 }), 5.6)
  .add(R.flow(fill, { count: 2, duration: 0.8, color: "#34d399" }), 5.9)
// 6.6–9.6 s: zoom on the fast path; request 2 is a hit.
  .add(R.focus(world, redis, { scale: 1.2, at: [1060, 470], duration: 1.1 }), 6.6)
  .from(".r2", { opacity: 0, x: -30, duration: 0.5 }, 7.0)
  .add(R.flow(toRedis, { count: 1, duration: 0.45, size: 11, color: "#34d399" }), 7.6)
  .add(R.flow(toRedis, { count: 1, duration: 0.45, size: 11, color: "#34d399", reverse: true }), 8.1)
  .from(".r2 .hit", { scale: 0, duration: 0.4, ease: "back.out(2.5)" }, 8.5)
  .add(R.count(".m2", 1.2, { decimals: 1, suffix: " ms", duration: 0.6 }), 8.0)
  .add(R.focus(world, null, { duration: 1 }), 9.0)
// 9.6–14 s: the code that does it, and the takeaway holds.
  .from(".editor", { opacity: 0, y: 40, duration: 0.6 }, 9.6)
  .add(code.type({ duration: 2 }), 9.9)
  .add(code.highlight(0, { color: "#34d399" }), 12.0)
  .to(".headline em", { textShadow: "0 0 40px rgba(52,211,153,.8)", duration: 0.6, yoyo: true, repeat: 1 }, 12.3);`,
};
