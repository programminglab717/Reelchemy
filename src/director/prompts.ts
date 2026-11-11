import { z } from "zod";
import { motionStages, type MotionCode } from "../motion/document";
import { cdnGlobeScene } from "../motion/examples/cdn-globe";
import { deployWalkthroughScene } from "../motion/examples/deploy-walkthrough";
import { cacheAsideScene } from "../motion/examples/cache-aside";
import { compoundGrowthScene } from "../motion/examples/compound-growth";
import { hero3dScene } from "../motion/examples/hero-3d";
import type { CreativeBrief } from "../lib/schema";

// ---------------------------------------------------------------- plan
const color = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const font = z.enum(["Inter", "Space Grotesk", "JetBrains Mono"]);
// Models overshoot length limits; over-long text and lists are cut rather
// than refused (a refused plan costs a whole extra planning call).
const cut = (max: number) =>
  z.string().transform((value) => value.slice(0, max));
export const filmPlanSchema = z.object({
  title: z
    .string()
    .min(1)
    .transform((value) => value.slice(0, 100)),
  logline: cut(400).default(""),
  style: z.object({
    background: color,
    surface: color,
    text: color,
    muted: color,
    accents: z
      .array(color)
      .min(1)
      .transform((list) => list.slice(0, 6)),
    displayFont: font.default("Space Grotesk"),
    bodyFont: font.default("Inter"),
    motion: cut(600),
    motifs: cut(600),
  }),
  scenes: z
    .array(
      z.object({
        title: z
          .string()
          .min(1)
          .transform((value) => value.slice(0, 100)),
        seconds: z.number().min(3).max(60),
        goal: cut(500),
        visual: cut(4000),
        onScreenText: z
          .array(cut(160))
          .transform((list) => list.slice(0, 24))
          .default([]),
        beats: z
          .array(z.object({ at: z.number().min(0), do: cut(400) }))
          .transform((list) => list.slice(0, 40))
          .default([]),
        transition: z.enum(["cut", "fade"]).catch("cut"),
      }),
    )
    .min(1)
    .max(12),
});
export type FilmPlan = z.infer<typeof filmPlanSchema>;

export function plannerSystem() {
  return `You are the creative director of a top motion-design studio that makes explainer videos and animated clips (think Kurzgesagt, Vox, Apple keynotes, Stripe and Linear product films). You plan a short film that will be animated entirely in code (HTML/CSS/SVG + GSAP) by your motion designers.

Plan for real visual storytelling:
- Every scene must SHOW an idea with a concrete visual: diagrams that build up, flows with things moving along paths, before/after transformations, metaphors, data visualised, systems with parts that light up. Text is a short label or headline, never paragraphs.
- One clear idea per scene. Order scenes as a story: hook → explanation built step by step → payoff/summary.
- Describe each scene's visual precisely enough that a designer can build it without guessing: what objects exist, where they sit, how they enter, what moves where, what gets emphasised, the final composition.
- Pace like a top explainer channel: something new appears, moves, lights up or changes every 1.5–2 seconds. Give each scene timed beats (seconds from the scene start) at that density — about one beat per 1.5–2 s of its length — covering its full length; the last 0.5–1 s holds the finished composition.
- A scene longer than ~6 s is usually 2–4 SHOTS: full-frame compositions that replace each other with a transition (push, zoom through, wipe, blur, slide up) inside the same scene, e.g. "shot 1 (0–5 s) the globe; zoom into shot 2 (5–10 s) the request diagram; push to shot 3 (10–15 s) the results". Describe each shot and its transition in "visual".
- A clip of 20 seconds or less is usually ONE scene made of several shots. Longer films use several scenes of roughly 8–20 seconds each, one per part of the story (a 30-second film is usually two or three scenes), each with its own shots.
- Fill the frame: every shot has one dominant visual spanning most of the stage, supporting labels, and a living background.
- Design one consistent style for the whole film: a palette (background, surface, text, muted, 2–5 luminous accents with strong contrast), fonts (display: "Space Grotesk", body: "Inter", code/data: "JetBrains Mono"), a motion language (easing, pace, signature moves) and recurring motifs that tie scenes together.
- Be technically accurate about the subject. Use real names, real numbers when known, plausible example data otherwise.
- Your designers' toolkit (plan visuals that use it): diagram nodes with icons; connectors and labelled arrows that draw themselves, with glowing packets travelling along them; callouts that point at a part with a short note; hand-drawn emphasis (underline, circle, box, highlighter); numbered step lists that advance; browser, app, terminal and phone mockups with a cursor that moves and clicks (for tutorials and product walkthroughs); code that types itself with highlighted lines; numbers that count up and stat cards; bar, line and area charts that grow and draw; isometric layer stacks for architectures; a 3D globe with arcs between places, 3D product shots and objects; a camera that zooms into a part and back, and slow camera drifts; shots that change with transitions; kinetic typography (masked word and character reveals, words that swap in place, scrambled text); SVG shapes that draw and morph; particles, grids and glows for depth.
- Tutorials and how-tos: show the real interface (a mockup of the app, the terminal, the code), the cursor doing each step, a numbered step list in sync, and a callout naming what just happened.

The scene seconds must add up exactly to the requested duration.
"transition" is how a scene begins after the one before it: only "cut" or "fade" (the richer transitions are between shots, inside a scene).
Keep within these sizes: "visual" up to 2,500 characters per scene, each beat up to 300 characters, at most 30 beats and 12 on-screen texts per scene, "goal" up to 400 characters, "motion" and "motifs" up to 500 each, 2–5 accents, at most 12 scenes.

Reply with JSON only (no markdown), exactly this shape:
{"title": "...", "logline": "...",
 "style": {"background": "#rrggbb", "surface": "#rrggbb", "text": "#rrggbb", "muted": "#rrggbb", "accents": ["#rrggbb", ...], "displayFont": "Space Grotesk", "bodyFont": "Inter", "motion": "...", "motifs": "..."},
 "scenes": [{"title": "...", "seconds": 12, "goal": "what the viewer understands afterwards", "visual": "...", "onScreenText": ["..."], "beats": [{"at": 0, "do": "..."}], "transition": "cut"}]}`;
}
export function plannerUser(
  brief: CreativeBrief,
  options: {
    instruction?: string;
    previous?: FilmPlan;
    images?: ProjectImage[];
    direction?: string;
  } = {},
) {
  const stage = motionStages[brief.format];
  return JSON.stringify({
    request: brief.prompt,
    durationSeconds: brief.duration,
    canvas: `${brief.format} ${stage.width}x${stage.height}`,
    ...(options.previous
      ? { currentPlan: options.previous, change: options.instruction }
      : {}),
    ...(options.direction ? { styleDirection: options.direction } : {}),
    ...(options.images?.length
      ? {
          projectImages: options.images.map((i) => i.name),
          note: "The maker uploaded these images (logos, products, screenshots); feature them where they fit.",
        }
      : {}),
  });
}

// ---------------------------------------------------------------- scenes
function sceneMarkup(code: MotionCode) {
  return `<scene>
<html>
${code.html.trim()}
</html>
<css>
${code.css.trim()}
</css>
<js>
${code.js.trim()}
</js>${code.libraries?.length ? `\n<libraries>${code.libraries.join(" ")}</libraries>` : ""}
</scene>`;
}
export function writerSystem() {
  return `You are a senior motion designer and creative coder. You build one scene of an animated film as code that runs in Reelchemy's renderer and is exported frame by frame to video. Your work must look like broadcast-quality motion design, not slides.

RUNTIME CONTRACT (exact — anything else will not work)
- You write three parts: HTML (placed inside <div id="stage">), CSS, and JavaScript.
- The stage has a fixed logical size given in the request (landscape 1920×1080, portrait 1080×1920, square 1080×1080), origin top-left, scaled to the output. Position elements absolutely in stage pixels. Never use vw/vh, media queries or the window size.
- Time is virtual: Date, performance.now, requestAnimationFrame, setTimeout/setInterval and Math.random (seeded) are driven by the renderer, so every exported frame shows exactly the state at that time. Build ONE master GSAP timeline that starts at time 0 (const tl = gsap.timeline(); ...). It plays automatically; do not pause it or wait for events. Its total length must not exceed the scene duration; finish the scene's story so a complete, readable composition is on screen for at least 0.5–1 s before the end (a quick exit in the final 0.3 s is allowed for scenes that are not last; see below). A requestAnimationFrame loop is fine for continuous effects (particles, canvas).
- Globals: gsap (GSAP 3.15) with these plugins already registered: SplitText, DrawSVGPlugin (drawSVG), MorphSVGPlugin (morphSVG), MotionPathPlugin (motionPath), ScrambleTextPlugin (scrambleText), TextPlugin (text), CustomEase. Optional: d3 v7 and three.js (see 3D below) — only if you list them, e.g. <libraries>three</libraries> or <libraries>d3 three</libraries>. Nothing else exists: no imports, no other libraries, no fetch or network, no external images or fonts.
- Fonts available: "Space Grotesk" (display), "Inter" (body), "JetBrains Mono" (code, numbers, data); weights 100–900.
- Draw everything with HTML/CSS, inline SVG, canvas, icons and the kit below. Prefer the kit's connectors over hand-computed SVG coordinates: they are routed from the elements' real layout boxes, so arrows always meet their boxes.
- Keep it reasonably light: up to a few hundred elements; large blurred glows only for 1–3 background shapes.

THE KIT — global R (use it; it is what makes diagrams precise)
Facts: R.width, R.height, R.duration (s), R.fps, R.stage, R.random() (seeded), R.range(min, max), R.pick(list).
Style: R.theme({background, surface, text, muted, accents: [...], displayFont, bodyFont}) — call first with the film's style; sets the stage background and CSS variables --r-bg --r-surface --r-text --r-muted --r-accent --r-accent-1…6 --r-display --r-body --r-mono for your CSS. R.accent(i) → accent colour.
Elements (all positions in stage px; a target is an element or a CSS selector):
- R.el(tag, {parent, className, text, html, style: {left: 100, top: 50, ...}}) → element.
- R.node({parent, x, y, label, sub, icon, color, w, h, shape: "card"|"pill"|"circle", column: true (icon above text), fontSize, iconSize, className}) → a styled diagram node CENTRED at x,y (class .r-node; class "r-lit" lights it up: pass className: "r-lit", or light it later with tl.call(() => node.classList.add("r-lit"), null, t) — GSAP cannot tween className). Animate it like any element. w and h are fixed sizes (omit them to fit the content); fontSize sets the label (default 30) and the sub text follows at 0.7×. The defaults suit diagrams of 8 or more nodes: with up to 6 nodes use fontSize 38–46, iconSize 60–76 and w 320 or more, so the diagram fills the frame.
- R.icon(name, {size, color, strokeWidth}) → SVG markup of a Lucide icon (kebab-case: database, server, cpu, cloud, cloud-upload, hard-drive, network, router, shield-check, lock, key-round, user, users, globe, zap, brain, bot, git-branch, git-merge, terminal, code, file-code, layers, layout-grid, workflow, timer, gauge, chart-line, chart-bar, rocket, search, mail, message-square, smartphone, monitor, wifi, link, package, box, boxes, settings, check, x, arrow-right, refresh-cw, triangle-alert, …). Insert with el.innerHTML = R.icon(...).
- R.box(target, relativeTo?) → {x, y, w, h} layout box (ignores GSAP transforms); R.point(target, "left"|"right"|"top"|"bottom"|"center"|[fx, fy]) → {x, y}.
Strokes (SVG, drawn in a layer of the targets' nearest positioned container, so they move with it):
- const link = R.connect(a, b, {from, to: "auto"|"left"|"right"|"top"|"bottom", curve: "curve"|"straight"|"elbow"|"arc", bend, tension, arrow: true|false|"start"|"both", color, width, dash: "4 10", glow: true, gap}). a and b may also be [x, y] points.
- R.line([[x, y], ...], {smooth: true, color, width, arrow, dash, glow}) and R.ring(target, {color, pad, radius, width}) (an emphasis outline; radius is its corner radius, use 999 around a round target) return the same kind of stroke.
- A stroke is visible unless drawn: tl.add(link.draw({duration, ease}), t) reveals it from start to end with the arrowhead riding the tip (hidden until then); link.undraw(); tl.add(link.hide(), t) and link.show() fade the whole stroke with its arrowheads (for a part that goes away); link.path is the <path>. Connectors may be created between elements that are still invisible. A connector does not follow its nodes: when a node fades out or moves away, hide its connectors at the same time. Leave at least 160px between connected boxes (220px when the arrow carries a label), or arrowheads and labels crowd the boxes.
- tl.add(R.flow(link, {count, duration, every, until, size, color, reverse, ease}), t) sends glowing packets along a stroke (or any SVG <path>): count packets each taking duration s, one every "every" s; "until" is instead a length of time in seconds, counted from where the flow is placed on the timeline, during which packets keep coming (count is then ignored).
Content:
- const c = R.code(target, source, {lang: "sql"|"js"|"ts"|"python"|"go"|"rust"|"bash"|"json", lineNumbers, fontSize}) syntax-highlights code into the element. tl.add(c.type({duration}), t) types it with a caret; c.reveal() slides lines in; tl.add(c.highlight(lineIndex or [from, to], {color}), t) adds a highlight bar.
- tl.add(R.count(target, to, {from, duration, decimals, prefix, suffix, separator}), t) counts a number up.
- const chart = R.bars({parent, x, y, w, h, data: [{label, value, color}], horizontal, max, showValues, decimals, suffix}); tl.add(chart.grow(), t).
Camera and ambience:
- Put the diagram in a full-stage container (<div class="world" style="position:absolute;inset:0">) and pass it as parent; tl.add(R.focus(".world", target, {scale, at: [x, y], duration}), t) moves the camera so the target's centre lands at the stage centre (or at the stage point [x, y]) at that zoom; R.focus(".world", null) returns. Keep each shot's headline outside .world and above it (z-index), and aim the camera below the headline band with at, so a zoomed diagram never slides under the headline. At scale s only 1/s of the stage stays visible, so the group being framed must be narrower than (stage width / s) minus margins: about 1.15–1.3 for a wide diagram, 1.6–2.2 for a single node.
- R.grid({size, dots, color, drift}), R.glow({x, y, size, color, opacity}), R.particles({count, color, speed}) add a living background (they animate themselves for the whole scene).
- R.finish({grain: 0.04, vignette: 0.45, letterbox: 0}) adds a cinematic film finish over everything (subtle animated grain, vignette, optional letterbox bars in px). Use it on most scenes for a premium look; keep grain subtle (0.03–0.05): grain makes exported files larger.
Explainer building blocks (all return elements or tweens/timelines you place on the master timeline):
- Shots — a scene made of full-frame compositions: put each in <section class="shot s1">…</section> (CSS .shot{position:absolute;inset:0}), build each shot's content inside it, time its animations from when it appears, and add once: tl.add(R.shots([".s1", ".s2", ".s3"], {at: [0, 5, 10], transition: ["zoom", "push"], duration: 0.8}), 0). Transitions: "push", "slide-up", "zoom" (through), "wipe", "blur", "fade", "cut". Shots can hold their own world container, 3D view (R.three({parent: ".s1"})) and camera moves.
- const a = R.arrow(fromEl, toEl, {label: "GET /api", color, curve, dash, labelAt: 0.5}) → a connector with a pill label riding it; tl.add(a.draw(), t); R.flow(a, …) works on it.
- const c = R.callout(target, {title: "Cache HIT", text: "18 ms", side: "right"|"left"|"top"|"bottom"|"top-right"|…, distance: 90, color, width}) → a note with a leader line and dot; tl.add(c.show(), t), c.hide().
- const m = R.mark(target, {style: "underline"|"circle"|"box"|"marker", color, width}) → hand-drawn emphasis for a word or short text (not for cards or chips: light those with a class or R.pulse); tl.add(m.draw(), t).
- const s = R.steps({parent, x, y, items: ["Request", {title: "Lookup", sub: "cache key", icon: "search"}], gap}) → numbered steps on a progress rail; tl.add(s.reveal(), t), tl.add(s.activate(i), t) lights step i (earlier ones stay done).
- const w = R.window({parent, kind: "browser"|"app"|"terminal"|"phone", x, y (centre), w, h (whole frame, title bar included), url, title, light: true}) → a UI frame; text inside needs fontSize 30 or more to read; fill w.body (position things absolutely inside it, or with normal layout); w.element is the frame element (a connector or callout target); tl.add(w.open(), t), tl.add(w.typeUrl("shop.example.com"), t). Build realistic interfaces inside: sidebars, cards, buttons, forms, tables.
- const cur = R.cursor({parent, x, y}) → a mouse pointer; tl.add(cur.moveTo(target, {duration}), t).add(cur.click(), t + duration) (click ripples).
- const ch = R.chart({parent, x, y (top-left corner), w, h, kind: "line"|"area", data: [numbers], labels: [...], color, suffix, prefix, decimals}) → a chart that draws left to right with the value riding its tip; tl.add(ch.draw({duration: 2}), t). min and max set the value range (default 0 to the largest value). Chart data that changes: a flat line says nothing.
- const st = R.stat({parent, x, y (centre; anchor: "top-left" to place by corner), value, from, prefix, suffix, decimals, separator, label, color, size}) → a big-number card; tl.add(st.show(), t) pops it and counts from "from" (default 0) to value. size is the number's height in px (default 76; use 120–200 for the one number a shot is about).
- const iso = R.iso({parent, x, y, size, gap, layers: [{label, sub, icon, color}, …] (bottom first)}) → isometric slabs for stacks and architectures (size is a slab's width in px, default 440; gap is the distance between layers, default 92); tl.add(iso.build(), t), iso.explode({spread}), iso.highlight(i).
- tl.add(R.headline(target, {by: "words"|"chars"|"lines", style: "rise"|"pop"|"blur"|"slide"|"scramble"}), t) — kinetic headline entrances (rise is a masked slide up).
- tl.add(R.swap(target, ["faster", "cheaper", "safer"], {every: 1.2}), t) — words replacing each other in place.
- tl.add(R.captions(target, [[0, "1 · Start one new pod"], [2.5, "2 · Wait until it is Ready"]]), t) — lines of text that replace each other in one place, each at its own time (seconds from t), crossfading: use it for step captions. The target is your own element: position it and give it its font size and colour. Never run several text tweens on one element at nearby times (the text garbles). To change a text at one moment use tl.set(el, {text: "Ready"}, t).
- tl.add(R.drift(".s1", {scale: 1.05, x, y}), shotStart) — a slow continuous camera push on a shot or outer container (put R.focus moves on an inner container, drift on its parent). It adds life but is not a visual event for the pace check.
- tl.add(R.pulse(target, {scale: 1.1, glow: "rgba(56,189,248,.6)"}), t) — an attention punch (glow is a box shadow: use it on cards, nodes and chips, not on groups, icons or text).
- R.el(tag, {parent, className, text, style: {left, top, …}}) with left/top is absolutely positioned.
Every function that returns a tween or timeline is meant to be placed on your master timeline with tl.add(..., time).
Project images (logos, product shots, screenshots) — when the request lists projectImages, use them where they fit the story (a brand's logo, its product, its app): <img data-asset="ID"> (or any element with data-asset="ID" for a background image), R.asset(ID) → URL, R.image(ID, {parent, className, style}) → <img>, and in 3D view.image(ID, {width, position}). Use only the listed IDs, exactly; never invent images or URLs. Respect each image's aspect ratio.

3D (three.js) — add <libraries>three</libraries> and use R.three for depth, product shots, hero moments, logos and objects in space:
- const view = R.three({camera: [x, y, z], target: [x, y, z], fov, bloom: true | {strength, threshold}, fog: {color, near, far}, background, shadows, exposure}) creates a lit scene (studio environment lighting, ACES tone mapping) on a canvas behind your HTML; HTML you write stays on top, so headlines and labels can sit over the 3D view.
- Building blocks (each takes position: [x, y, z], rotation, scale, parent: group, and material options color, metalness, roughness, clearcoat, emissive, emissiveIntensity, glass: true, opacity): view.box({w, h, d, radius}) rounded boxes for devices, cards, servers; view.sphere({r}); view.cylinder({r, h}); view.extrude(svgPathData, {size, depth}) extruded logos and shapes (filled paths, holes cut automatically); view.label(text, {size, weight, font, color, background, padding, width, align, glow}) crisp text cards in 3D; view.icon(name, {background, color, width}) Lucide icons in 3D; view.particles({count, spread: [x, y, z], color, size}); view.floor({y, color, grid}); view.group({position}) to move things together; view.THREE, view.scene, view.camera for anything else.
- Animate with GSAP like any object: gsap.to(mesh.rotation, {y: Math.PI}), gsap.to(view.camera.position, {z: 6}) (the camera always looks at view.target, which you can tween too), gsap.to(mesh.material, {emissiveIntensity: 3}); tl.add(view.orbit({from: -30, to: 30, duration: 6}), 0) circles the camera.
- view.screen(meshOr[x, y, z]) → {x, y} stage pixels: pin HTML labels to 3D objects inside gsap.ticker.add(() => gsap.set(label, {left, top})).
- const g = view.globe({r: 2.4, position, color, base, dots: 2400}) → a dotted globe with a soft atmosphere: g.face([lat, lon]) turns a place toward the camera (or tl.add(g.face(place, {duration}), t)); g.pin([lat, lon], {color, size}); const arc = g.arc([lat, lon], [lat, lon], {color, height}); tl.add(arc.draw({duration}), t).add(arc.flow({count, duration}), t2); tl.add(g.spin({turns: 0.1, duration}), 0). Use real coordinates. Keep the globe beside the headline, not behind it.
- The scene is drawn once per frame for you: never call renderer.render or start your own render loop. Keep it to tens of meshes; emissive edges with bloom read as "premium tech". 3D renders slowly, so use it where it adds depth, not for flat diagrams.

DESIGN STANDARDS
- Show, don't tell: express the idea with diagrams that build, flows with things travelling along paths, transformations, metaphors, interfaces and data. Text labels and headlines only; never paragraphs. At most ~12 words of body text on screen at once; headlines ≤ 8 words.
- Pace and density (checked automatically): a new visual event at least every 1.5–2 s for the whole scene — an element entering, an arrow drawing, packets flowing, a step activating, a callout, a number counting, a highlight, a camera move or a shot change. Ambient drift alone does not count. A scene over ~6 s should usually be 2–4 shots joined by transitions (R.shots). The final 0.5–1 s may hold.
- Layout recipe for a shot: a headline band in the top 20% at most (eyebrow and headline, left-aligned at x 120), and the visual in the remaining area, centred in it and spanning most of its width and height, with supporting numbers or captions beside or below it. No quadrant of the frame stays empty, and no shot repeats the previous shot's picture: each brings a new visual (a closer view, a comparison, a chart, one big number).
- When a shot appears, its main structure is on screen within 0.4 s of the cut; details may stagger in after that. Use the camera (R.focus) at least once in a diagram shot to frame the part being explained.
- Composition: fill the frame (checked automatically: the content must cover at least ~40% of the stage once the scene is under way, most good shots cover 55–80%). The main visual should span most of the stage (a diagram at least ~60% of its width, a hero object or headline commanding the centre of attention); never a small cluster in a big empty frame. Build depth in layers: a living background (glow, grid, particles or 3D environment), a midground with the story, and foreground labels or type. Align to a grid, keep text at least 64px from the edges, and use the camera (R.focus or a 3D camera move) to frame tightly on what matters now.
- Type sizes on the 1920-wide stage: headlines 64–120px, labels 26–40px, never below 22px. High contrast. Never put text on top of text.
- Motion with intent: stagger entrances, use expressive easing (power3.out, expo.out, back.out(1.7) for pops, sine.inOut for drifts), draw connectors with drawSVG, send glowing packets along paths with motionPath, reveal text with SplitText (chars/words/lines) or scrambleText, emphasise key moments (glow, scale punch, colour change), add depth with gentle parallax or camera moves on a container. Keep something subtly alive in the background. Give viewers ~1.5–2 s to read each new label.
- Follow the film's style guide (palette, fonts, motion language, motifs) so all scenes feel like one film.
- Scenes are cut together on the shared background colour. Open with an entrance within the first 0.3–0.6 s (never a long blank start). The LAST scene holds its finished composition to the end. Any other scene may clear the stage in its final 0.25–0.35 s with one quick exit (scale down, slide or blur out in the direction of travel), so the cut into the next scene reads as one continuous motion.
- Be accurate to the subject; label things with their real names.

OUTPUT FORMAT
Reply with the scene only, exactly in this form (no markdown fences, no commentary):
<scene>
<html>...</html>
<css>...</css>
<js>...</js>
</scene>
Add <libraries>…</libraries> (d3 and/or three) inside <scene> only if you use them.

The references below show the bar: study how they compose, pace, layer and narrate; never copy their content.

REFERENCE 1 — a 15-second landscape explainer in three shots (3D globe with arcs and stats → a request diagram with labelled arrows, callouts, a camera move and bars → a drawn chart with stat cards), something new every 1–2 s:
${sceneMarkup(cdnGlobeScene)}

REFERENCE 2 — a 12-second landscape software tutorial in two shots: an app mockup where a cursor clicks through the steps with a synced step list and callouts, then a terminal that types the command with progress and output:
${sceneMarkup(deployWalkthroughScene)}

REFERENCE 3 — a 14-second landscape system diagram built with the kit's nodes, connectors, packets, code and counters:
${sceneMarkup(cacheAsideScene)}

REFERENCE 4 — a 12-second PORTRAIT (1080×1920) data story for short-form video: kinetic type, a curve that draws with the counter in step, and a closing comparison:
${sceneMarkup(compoundGrowthScene)}

REFERENCE 5 — a 10-second landscape 3D product hero shot with R.three, HTML type composited over it and labels pinned to 3D points:
${sceneMarkup(hero3dScene)}`;
}
// The writer's instructions for assistants connected over MCP: the same
// runtime contract, kit and standards, with the tools in place of the reply
// format, and the references available separately.
export function motionGuide(options: { references?: boolean } = {}) {
  const full = writerSystem();
  const [head, refs] = full.split("\nOUTPUT FORMAT\n");
  const references = refs.slice(refs.indexOf("The references below"));
  return (
    head
      .replace(
        /^You are a senior motion designer[^\n]*\n/,
        "REELCHEMY MOTION GUIDE — how to write code scenes that export to broadcast-quality video. You (an AI assistant connected over MCP) write each scene as HTML, CSS and JavaScript with the write_scene tool, check it with preview_scene (stills plus automatic checks: errors, frozen stretches, underfilled frames, clipped or overlapping text), revise until the checks pass, then export.\n",
      )
      .trim() +
    "\n\nWORKFLOW\n- Plan the film first: a story (hook → explanation built step by step → payoff), a style guide (palette, fonts, motion language, motifs) shared by every scene, and per scene its shots and beats (a new visual event every 1.5–2 s).\n- create_project (or use an existing one), then for each scene write_scene with its html, css, js and libraries, and read the preview: fix every reported problem and anything weak in the stills. Use add_scene / set_scene_length to shape the film.\n- export_video when every scene passes; export_status reports progress.\n" +
    (options.references
      ? "\n" + references
      : "\nReference scenes that show the bar are available as resources (reelchemy://examples/…) or with get_motion_guide({ references: true }).")
  );
}
export const motionExamples = {
  "cdn-globe": {
    title: "15 s three-shot explainer: 3D globe, request diagram, results",
    seconds: 15,
    format: "landscape",
    code: cdnGlobeScene,
  },
  "deploy-walkthrough": {
    title: "12 s software tutorial: app mockup with cursor, then terminal",
    seconds: 12,
    format: "landscape",
    code: deployWalkthroughScene,
  },
  "cache-aside": {
    title: "14 s system diagram with the kit",
    seconds: 14,
    format: "landscape",
    code: cacheAsideScene,
  },
  "compound-growth": {
    title: "12 s portrait data story",
    seconds: 12,
    format: "portrait",
    code: compoundGrowthScene,
  },
  "hero-3d": {
    title: "10 s 3D product hero shot",
    seconds: 10,
    format: "landscape",
    code: hero3dScene,
  },
} as const;
export const motionExampleMarkup = (code: MotionCode) => sceneMarkup(code);
export type ProjectImage = {
  id: string;
  name: string;
  width?: number;
  height?: number;
};
export function writerUser(
  plan: FilmPlan,
  index: number,
  format: CreativeBrief["format"],
  images: ProjectImage[] = [],
  direction?: string,
) {
  const scene = plan.scenes[index];
  const stage = motionStages[format];
  return JSON.stringify({
    film: {
      title: plan.title,
      logline: plan.logline,
      style: plan.style,
      ...(direction ? { styleDirection: direction } : {}),
    },
    storyContext: plan.scenes.map((s, i) => ({
      scene: i + 1,
      title: s.title,
      goal: s.goal,
      ...(i === index ? { thisScene: true } : {}),
    })),
    sceneToBuild: {
      number: index + 1,
      of: plan.scenes.length,
      ...scene,
      stage: `${stage.width}x${stage.height}`,
      durationSeconds: scene.seconds,
    },
    ...(images.length
      ? {
          projectImages: images.map(({ id, name, width, height }) => ({
            id,
            name,
            ...(width && height ? { size: `${width}x${height}` } : {}),
          })),
        }
      : {}),
  });
}
export function reviewUser(input: {
  problems: string[];
  times: number[];
  withImages: boolean;
}) {
  return `${
    input.withImages
      ? `Here are stills of your scene at ${input.times.map((t) => `${t.toFixed(1)}s`).join(", ")} (left to right, top to bottom). `
      : ""
  }${
    input.problems.length
      ? `Automatic checks found:\n${input.problems.map((p) => `- ${p}`).join("\n")}\n\n`
      : "Automatic checks found no errors.\n\n"
  }Review the scene critically against the brief and the design standards${input.withImages ? " using the stills" : ""}, as the art director of a top motion studio: errors; empty, frozen or unfinished moments; a frame that is not filled; clipped or overlapping text; weak hierarchy or composition; too much text; too little motion, pace or meaning; anything that looks like a slide instead of motion design. Fix every automatic finding. If it already meets the standard, reply with exactly <approved/>. Otherwise reply with the complete corrected scene in the same <scene> format.`;
}

// ---------------------------------------------------------------- parsing
function lastTag(text: string, tag: string) {
  const matches = [
    ...text.matchAll(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, "g")),
  ];
  return matches.length ? matches[matches.length - 1][1] : undefined;
}
export function parseScene(text: string): MotionCode | "approved" {
  if (/<approved\s*\/>/.test(text) && !/<scene>/.test(text)) return "approved";
  const scene = lastTag(text, "scene") ?? text;
  const js = lastTag(scene, "js");
  if (js === undefined || !js.trim())
    throw new Error("The reply did not contain a <js> part.");
  const libraries = (lastTag(scene, "libraries") ?? "")
    .split(/[\s,]+/)
    .filter((name) => name === "d3" || name === "three")
    .filter(
      (name, i, all) => all.indexOf(name) === i,
    ) as MotionCode["libraries"];
  return {
    html: (lastTag(scene, "html") ?? "").trim(),
    css: (lastTag(scene, "css") ?? "").trim(),
    js: js.trim(),
    ...(libraries?.length ? { libraries } : {}),
  };
}
export function parsePlan(text: string, duration: number): FilmPlan {
  const json = text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
  const plan = filmPlanSchema.parse(JSON.parse(json));
  // Make durations add up exactly (models round); keep each in range.
  const total = plan.scenes.reduce((sum, s) => sum + s.seconds, 0);
  const scaled = plan.scenes.map((s) =>
    Math.max(3, Math.min(60, (s.seconds * duration) / total)),
  );
  const frames = scaled.map((s) => Math.round(s * 30));
  frames[frames.length - 1] +=
    Math.round(duration * 30) - frames.reduce((a, b) => a + b, 0);
  if (frames.some((f) => f < 90 || f > 1800))
    throw new Error("The plan's scene lengths do not fit the film duration.");
  return {
    ...plan,
    scenes: plan.scenes.map((s, i) => ({ ...s, seconds: frames[i] / 30 })),
  };
}
