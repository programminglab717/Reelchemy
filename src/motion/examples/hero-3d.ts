import type { MotionCode } from "../document";

// Reference example (10 s, landscape): a 3D product-style hero shot with
// three.js through R.three — a dark device card with an extruded logo, light that
// sweeps across it, a camera dolly, and HTML type composited over the 3D view
// with labels pinned to 3D positions.
export const hero3dScene: MotionCode = {
  libraries: ["three"],
  html: `
<div class="eyebrow">INTRODUCING</div>
<h1 class="headline">Nimbus <span>Edge</span></h1>
<p class="sub">Serverless Postgres at the edge, in every region.</p>
<div class="pin p1"><b>12 ms</b> reads</div>
<div class="pin p2"><b>35</b> regions</div>
<div class="pin p3"><b>99.99%</b> uptime</div>`,
  css: `
.eyebrow{position:absolute;left:140px;top:300px;font:600 28px var(--r-mono);letter-spacing:.4em;color:var(--r-accent)}
.headline{position:absolute;left:140px;top:350px;margin:0;font:700 124px/1 var(--r-display);letter-spacing:-.03em;color:#f8fafc}
.headline span{color:#7dd3fc}
.sub{position:absolute;left:144px;top:520px;margin:0;font:400 34px var(--r-body);color:#94a3b8;width:620px}
.pin{position:absolute;padding:12px 20px;border-radius:14px;background:rgba(8,12,24,.72);border:1px solid rgba(125,211,252,.35);font:500 26px var(--r-body);color:#cbd5e1;white-space:nowrap}
.pin b{font:700 28px var(--r-mono);color:#7dd3fc;margin-right:8px}`,
  js: `
R.theme({ background: "#03050b", accents: ["#7dd3fc", "#c4b5fd"] });
R.finish({ grain: 0.04, vignette: 0.45 });
const view = R.three({ camera: [7.4, 2.6, 15.5], target: [1.4, 0.2, 0], bloom: { strength: 0.5 }, fog: { color: "#03050b", near: 12, far: 30 } });
view.particles({ count: 600, spread: [30, 14, 24], color: "#93c5fd", size: 0.035, opacity: 0.6 });
view.floor({ y: -2.2, color: "#04070f", grid: "#0f1a33" });

// The product: a dark device card with an extruded logo on a metal base.
const product = view.group({ position: [3.4, 0.2, 0] });
const card = view.box({ w: 3.4, h: 4.4, d: 0.22, radius: 0.28, color: "#0b1222", metalness: 0.6, roughness: 0.18, clearcoat: 1, parent: product });
const base = view.box({ w: 3.6, h: 0.18, d: 1.4, radius: 0.08, position: [0, -2.35, 0], color: "#1e293b", metalness: 0.9, roughness: 0.25, parent: product });
const logo = view.extrude("M50 0 L100 28 L100 72 L50 100 L0 72 L0 28 Z M50 22 L30 34 L30 66 L50 78 L70 66 L70 34 Z", { size: 1.6, depth: 0.35, color: "#7dd3fc", emissive: "#0ea5e9", emissiveIntensity: 1.4, metalness: 0.4, roughness: 0.2, parent: product, position: [0, 0.3, 0.3] });
const glow = view.box({ w: 3.0, h: 0.05, d: 0.05, radius: 0.02, emissive: "#c4b5fd", emissiveIntensity: 3, color: "#c4b5fd", position: [0, -1.6, 0.14], parent: product });

// HTML labels follow points on the product as the camera moves.
const pins = [[".p1", [1.9, 1.6, 0]], [".p2", [5.3, 0.6, 0]], [".p3", [1.8, -1.2, 0]]];
gsap.set(".pin", { xPercent: -50, yPercent: -50 });
const follow = () => pins.forEach(([sel, p]) => { const at = view.screen(p); gsap.set(sel, { left: at.x, top: at.y }); });
gsap.ticker.add(follow);

const tl = gsap.timeline({ defaults: { ease: "power3.out" } });
// The camera travels in one curve: down and in, then settling beside the product.
tl.add(view.fly([{ camera: [6.6, 1.2, 13] }, { camera: [5.5, 1.4, 12] }], { duration: 9.5, ease: "power2.out" }), 0)
  .from(product.position, { y: -5, duration: 1.6, ease: "expo.out" }, 0.1)
  .from(product.rotation, { y: -1.2, duration: 2.4, ease: "power3.out" }, 0.1)
  .to(product.rotation, { y: 0.35, duration: 7, ease: "sine.inOut" }, 2.5)
  .from(logo.scale, { x: 0.01, y: 0.01, duration: 0.9, ease: "back.out(1.8)" }, 1.1)
  .from(glow.scale, { x: 0.01, duration: 0.8 }, 1.4)
  .from(".eyebrow", { duration: 1, scrambleText: { text: "", chars: "01" } }, 1.4)
  .from(new SplitText(".headline", { type: "chars" }).chars, { y: 80, opacity: 0, duration: 0.9, stagger: 0.04 }, 1.7)
  .from(".sub", { opacity: 0, y: 24, duration: 0.8 }, 2.5)
  .from(".pin", { opacity: 0, scale: 0.8, duration: 0.6, stagger: 0.25 }, 3.6)
  .add(R.count(".p1 b", 12, { suffix: " ms", duration: 1 }), 3.6)
  .add(R.count(".p2 b", 35, { duration: 1 }), 3.85)
  .add(R.count(".p3 b", 99.99, { decimals: 2, suffix: "%", duration: 1 }), 4.1)
  .fromTo(logo.material, { emissiveIntensity: 0.6 }, { emissiveIntensity: 2.4, duration: 0.5, yoyo: true, repeat: 1, ease: "sine.inOut" }, 6.2);`,
};
