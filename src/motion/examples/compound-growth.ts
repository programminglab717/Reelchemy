import type { MotionCode } from "../document";

// Reference example (12 s, portrait 1080×1920): a data story for short-form
// video — kinetic type, a growth curve that draws itself with its arrowhead
// riding the tip, a synchronised counter and a closing comparison.
export const compoundGrowthScene: MotionCode = {
  html: `
<div class="eyebrow">THE MATH OF PATIENCE</div>
<h1 class="headline"><span>$100 a month.</span><span class="accent">30 years.</span></h1>
<div class="chart">
  <div class="gridline" style="top:0"></div><div class="gridline" style="top:200px"></div><div class="gridline" style="top:400px"></div><div class="axis"></div>
  <div class="ylab" style="top:-18px">$120k</div><div class="ylab" style="top:182px">$80k</div><div class="ylab" style="top:382px">$40k</div>
  <div class="xlab" style="left:0">Year 0</div><div class="xlab" style="left:257px">10</div><div class="xlab" style="left:513px">20</div><div class="xlab end" style="left:770px">30</div>
</div>
<div class="total-label">Your balance</div>
<div class="total">$0</div>
<div class="split"></div>
<div class="closing">Start early. Let time do the work.</div>`,
  css: `
.eyebrow{position:absolute;left:96px;top:190px;font:600 30px var(--r-mono);letter-spacing:.28em;color:var(--r-accent-2)}
.headline{position:absolute;left:96px;top:250px;margin:0;font:700 112px/1.02 var(--r-display);letter-spacing:-.02em}
.headline span{display:block}.headline .accent{color:var(--r-accent)}
.chart{position:absolute;left:210px;top:640px;width:770px;height:600px}
.gridline{position:absolute;left:0;right:0;height:1px;background:rgba(148,163,184,.16)}
.axis{position:absolute;left:0;right:0;top:600px;height:2px;background:rgba(148,163,184,.45)}
.ylab{position:absolute;right:calc(100% + 18px);font:500 26px var(--r-mono);color:var(--r-muted);white-space:nowrap}
.xlab{position:absolute;top:620px;transform:translateX(-50%);font:500 26px var(--r-mono);color:var(--r-muted)}
.xlab:first-of-type{transform:none}.xlab.end{transform:translateX(-100%)}
.total-label{position:absolute;left:96px;top:1296px;font:500 32px var(--r-body);color:var(--r-muted)}
.total{position:absolute;left:96px;top:1372px;font:700 132px var(--r-mono);color:var(--r-text);letter-spacing:-.03em}
.split .r-bar-label{font-size:28px;color:var(--r-text)}
.split .r-bar-value{font-size:30px}
.closing{position:absolute;left:96px;top:1760px;font:600 46px var(--r-display);color:var(--r-text)}`,
  js: `
R.theme({ background: "#07130f", surface: "#0d1f19", text: "#ecfdf5", muted: "#8fb5a6",
  accents: ["#34d399", "#a7f3d0", "#fbbf24"], displayFont: "Space Grotesk", bodyFont: "Inter" });
R.grid({ size: 72, dots: true, color: "rgba(167,243,208,0.10)" });
R.glow({ x: 900, y: 900, size: 900, color: "#059669", opacity: 0.28 });

// $100 a month at 7% a year, compounded monthly.
const r = 0.07 / 12;
const balance = (years) => 100 * ((1 + r) ** (12 * years) - 1) / r;
const chart = R.box(".chart");
const points = [];
for (let y = 0; y <= 30; y += 0.5)
  points.push([chart.x + (y / 30) * chart.w, chart.y + chart.h - (balance(y) / 120000) * chart.h]);
const curve = R.line(points, { smooth: true, width: 7, glow: 10, arrow: true, headSize: 30 });
// Soft area under the curve, revealed after the line.
const area = document.createElementNS("http://www.w3.org/2000/svg", "path");
area.setAttribute("d", curve.d + " L" + (chart.x + chart.w) + " " + (chart.y + chart.h) + " L" + chart.x + " " + (chart.y + chart.h) + " Z");
area.setAttribute("fill", "rgba(52,211,153,0.14)");
curve.group.insertBefore(area, curve.path);
const split = R.bars({ parent: document.querySelector(".split"), x: 96, y: 1590, w: 888, h: 150, horizontal: true, labelWidth: 250, prefix: "$",
  data: [{ label: "You put in", value: 36000, color: "#a7f3d0" }, { label: "Growth", value: 85997, color: "#34d399" }] });

const tl = gsap.timeline({ defaults: { ease: "power3.out" } });
tl.from(".eyebrow", { duration: 0.8, scrambleText: { text: "", chars: "$%0123456789" } }, 0)
  .from(".headline span", { yPercent: 60, opacity: 0, duration: 0.8, stagger: 0.25 }, 0.2)
  .from(".chart > *", { opacity: 0, duration: 0.5, stagger: 0.03 }, 1.0)
// 1.6–6.6 s: thirty years in five seconds; the counter follows the curve.
  .add(curve.draw({ duration: 5, ease: "power1.in" }), 1.6)
  .from(".total-label, .total", { opacity: 0, y: 20, duration: 0.5 }, 1.6)
  .add(R.count(".total", 121997, { prefix: "$", duration: 5, ease: "power3.in" }), 1.6)
  .from(area, { opacity: 0, duration: 0.8 }, 6.4)
  .add(R.ring(".total", { pad: 12, color: "#fbbf24" }).draw({ duration: 0.6 }), 6.8)
// 7.4–10 s: most of it is growth, not deposits.
  .add(split.grow({ duration: 1, stagger: 0.3 }), 7.4)
  .from(".closing", { opacity: 0, y: 30, duration: 0.7 }, 9.6)
  .to(".headline .accent", { textShadow: "0 0 50px rgba(52,211,153,.7)", duration: 0.6, yoyo: true, repeat: 1 }, 10.2);`,
};
