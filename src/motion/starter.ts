import type { MotionCode } from "./document";
import type { Timeline } from "../lib/schema";

// A small, working code scene to start from when a layered scene is turned
// into code: its title animates in over a living background, using the kit.
export function starterCode(scene: {
  title: string;
  background: string;
  accent: string;
  format: Timeline["format"];
}): MotionCode {
  const portrait = scene.format === "portrait";
  return {
    html: `<div class="eyebrow">SCENE</div>
<h1 class="title"></h1>`,
    css: `.eyebrow{position:absolute;left:${portrait ? 96 : 140}px;top:${portrait ? 700 : 380}px;font:600 28px var(--r-mono);letter-spacing:.3em;color:var(--r-accent)}
.title{position:absolute;left:${portrait ? 96 : 140}px;top:${portrait ? 760 : 430}px;width:${portrait ? 888 : 1500}px;margin:0;font:700 ${portrait ? 96 : 110}px/1.05 var(--r-display);letter-spacing:-.01em}`,
    js: `R.theme({ background: ${JSON.stringify(scene.background)}, accents: [${JSON.stringify(scene.accent)}] });
R.grid({ drift: true });
R.glow({ x: R.width * 0.2, y: R.height * 0.2, opacity: 0.3 });
R.particles({ count: 24 });
const title = document.querySelector(".title");
title.textContent = ${JSON.stringify(scene.title)};
const words = new SplitText(title, { type: "words" }).words;
const tl = gsap.timeline({ defaults: { ease: "power3.out" } });
tl.from(".eyebrow", { duration: 0.8, scrambleText: { text: "", chars: "01" } }, 0.1)
  .from(words, { y: 60, opacity: 0, duration: 0.8, stagger: 0.08 }, 0.3);`,
  };
}
