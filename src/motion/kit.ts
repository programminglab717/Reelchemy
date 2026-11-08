import { gsapPlugins, motionFonts } from "./libraries";

// The helper kit available to scene code as `R`: stage facts, icons, and
// layout-aware motion primitives (connectors, packets, nodes, code, counters,
// charts, emphasis, camera and ambience) so scene authors compose instead of
// computing geometry by hand. Plain ES2020; no template literals inside, as
// this source is itself a template.
export const KIT_SOURCE = String.raw`(() => {
  const config = window.__REELCHEMY_CONFIG__;
  const icons = window.__reelchemyIcons || {};
  // The frame (background, theme) and the content root, which differ when the
  // scene's content is scaled to fit the frame.
  const frame = document.getElementById("stage");
  const stage = document.getElementById("r-fit") || frame;
  const NS = "http://www.w3.org/2000/svg";
  const escape = (value) => String(value).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const iconNode = ([tag, attributes]) =>
    "<" + tag + Object.entries(attributes || {}).map(([k, v]) => " " + k + '="' + escape(v) + '"').join("") + "/>";
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const css = (el, styles) => { for (const k in styles || {}) { if (k.startsWith("--")) el.style.setProperty(k, styles[k]); else el.style[k] = typeof styles[k] === "number" && !/opacity|zIndex|flex|fontWeight|lineHeight/.test(k) ? styles[k] + "px" : styles[k]; } return el; };
  const resolve = (target, name) => {
    const el = typeof target === "string" ? stage.querySelector(target) : target;
    if (!el) throw new Error((name || "R") + ": element not found: " + target);
    return el;
  };

  const style = document.createElement("style");
  style.textContent = [
    "#stage{--r-bg:#070b18;--r-surface:#0f172a;--r-text:#e2e8f0;--r-muted:#94a3b8;--r-accent:#38bdf8;--r-accent-1:#38bdf8;--r-accent-2:#a78bfa;--r-accent-3:#f472b6;--r-accent-4:#34d399;--r-accent-5:#fbbf24;--r-accent-6:#fb7185;--r-display:'Space Grotesk';--r-body:'Inter';--r-mono:'JetBrains Mono'}",
    ".r-layer{position:absolute;left:0;top:0;overflow:visible;pointer-events:none}",
    ".r-node{position:absolute;display:flex;align-items:center;justify-content:center;gap:16px;padding:0 26px;border-radius:22px;background:color-mix(in srgb,var(--r-surface) 88%,transparent);border:2px solid color-mix(in srgb,var(--r-accent) 55%,transparent);box-shadow:0 24px 60px rgba(0,0,0,.42),0 0 46px color-mix(in srgb,var(--r-accent) 20%,transparent),inset 0 1px 0 rgba(255,255,255,.06);color:var(--r-text);font:600 30px var(--r-display);text-align:center;white-space:nowrap}",
    ".r-node.r-column{flex-direction:column;gap:10px;padding:20px 24px}",
    ".r-node.r-pill{border-radius:999px}.r-node.r-circle{border-radius:50%;padding:0}",
    ".r-node .r-icon{display:flex;color:var(--r-accent);flex:none}",
    ".r-node .r-text{display:flex;flex-direction:column;gap:4px;align-items:inherit}",
    ".r-node:not(.r-column) .r-text{align-items:flex-start;text-align:left}",
    ".r-node .r-sub{font:500 21px var(--r-mono);color:var(--r-muted);letter-spacing:.02em}",
    ".r-node.r-lit{border-color:var(--r-accent);background:color-mix(in srgb,var(--r-accent) 18%,var(--r-surface));box-shadow:0 0 0 4px color-mix(in srgb,var(--r-accent) 22%,transparent),0 0 70px color-mix(in srgb,var(--r-accent) 45%,transparent)}",
    ".r-code{font:500 30px/1.6 var(--r-mono);color:var(--r-text);white-space:pre;tab-size:2}",
    ".r-code .r-ln{position:relative;display:block;padding-left:0}",
    ".r-code.r-numbered .r-ln{padding-left:2.6em}",
    ".r-code.r-numbered .r-ln::before{content:attr(data-n);position:absolute;left:0;width:1.8em;text-align:right;color:var(--r-muted);opacity:.5}",
    ".r-code .r-hl{position:absolute;left:-14px;right:-14px;border-radius:10px;background:color-mix(in srgb,var(--r-accent) 18%,transparent);box-shadow:inset 3px 0 0 var(--r-accent);z-index:-1}",
    ".r-code .r-caret{display:inline-block;width:.55em;height:1.15em;vertical-align:-.2em;background:var(--r-accent);margin-left:1px}",
    ".tk-k{color:#c084fc}.tk-s{color:#86efac}.tk-n{color:#fbbf24}.tk-c{color:#64748b;font-style:italic}.tk-f{color:#7dd3fc}.tk-t{color:#f472b6}.tk-p{color:#94a3b8}.tk-v{color:#fda4af}",
    ".r-bars{position:absolute}.r-bar{position:absolute;border-radius:12px 12px 4px 4px;background:var(--r-accent)}",
    ".r-bars.r-horizontal .r-bar{border-radius:4px 12px 12px 4px}",
    ".r-bar-label{position:absolute;font:500 24px var(--r-body);color:var(--r-muted);text-align:center;white-space:nowrap}",
    ".r-bar-value{position:absolute;font:700 28px var(--r-mono);color:var(--r-text);text-align:center;white-space:nowrap}",
    ".r-grid{position:absolute;inset:0;pointer-events:none}",
    ".r-glow{position:absolute;border-radius:50%;pointer-events:none;filter:blur(80px)}",
    ".r-particle{position:absolute;border-radius:50%;pointer-events:none}",
  ].join("\n");
  // First in <head>, so a scene's own CSS wins over these defaults.
  document.head.insertBefore(style, document.head.firstChild);
  // Project images: the host sends their bytes (the scene cannot fetch them),
  // and they become local blob URLs, decoded before scene code runs.
  const assetUrls = {}, assetImages = {};
  window.__reelchemyAssets = (config.assets || []).length
    ? new Promise((resolve) => {
        let received = false;
        window.addEventListener("message", (event) => {
          if (received || event.source !== parent || !event.data || event.data.reelchemy !== "assets") return;
          received = true;
          const files = event.data.files || {};
          Promise.all(config.assets.map((id) => {
            const file = files[id];
            if (!file) return null;
            const url = URL.createObjectURL(new Blob([file.bytes], { type: file.type || "image/png" }));
            assetUrls[id] = url;
            const image = new Image();
            image.src = url;
            assetImages[id] = image;
            return image.decode().catch(() => {});
          })).then(() => {
            for (const el of document.querySelectorAll("[data-asset]")) {
              const url = assetUrls[el.getAttribute("data-asset")];
              if (!url) continue;
              if (el.tagName === "IMG") el.src = url;
              else el.style.backgroundImage = 'url("' + url + '")';
            }
            resolve();
          });
        });
        parent.postMessage({ reelchemy: "assets", ids: config.assets }, "*");
      })
    : Promise.resolve();
  // A 3D scene waits for its three.js modules (see the document's module).
  window.__reelchemyThree = config.three
    ? new Promise((resolve) => { window.__reelchemyThreeReady = resolve; })
    : Promise.resolve();
  // Scene code measures layout, so it runs once the fonts are ready.
  window.__reelchemyFonts = Promise.all(
    ${JSON.stringify(Object.keys(motionFonts))}.map((family) => document.fonts.load('400 32px "' + family + '"').catch(() => [])),
  ).then(() => {});

  // ------------------------------------------------------------ geometry
  // Untransformed layout box of an element in stage pixels (or relative to
  // another element): GSAP transforms such as from({scale:0}) do not move it.
  function stageBox(el) {
    if (el === stage) return { x: 0, y: 0, w: config.stage.width, h: config.stage.height };
    if (el instanceof SVGElement && !(el instanceof SVGSVGElement)) {
      const svg = el.ownerSVGElement;
      const outer = stageBox(svg);
      const b = el.getBBox();
      const vb = svg.viewBox && svg.viewBox.baseVal;
      const sx = vb && vb.width ? outer.w / vb.width : 1;
      const sy = vb && vb.height ? outer.h / vb.height : 1;
      const ox = vb && vb.width ? vb.x : 0, oy = vb && vb.height ? vb.y : 0;
      return { x: outer.x + (b.x - ox) * sx, y: outer.y + (b.y - oy) * sy, w: b.width * sx, h: b.height * sy };
    }
    if (!(el instanceof HTMLElement)) {
      const r = el.getBoundingClientRect(), s = stage.getBoundingClientRect();
      const k = s.width / config.stage.width || 1;
      return { x: (r.left - s.left) / k, y: (r.top - s.top) / k, w: r.width / k, h: r.height / k };
    }
    let x = 0, y = 0, n = el;
    while (n && n !== stage) {
      x += n.offsetLeft; y += n.offsetTop;
      const parent = n.offsetParent;
      if (parent && parent !== stage && parent instanceof HTMLElement) { x += parent.clientLeft; y += parent.clientTop; }
      if (!parent || parent === document.body) break;
      n = parent;
    }
    return { x, y, w: el.offsetWidth, h: el.offsetHeight };
  }
  function box(target, relativeTo) {
    const b = stageBox(resolve(target, "R.box"));
    if (!relativeTo) return b;
    const rel = resolve(relativeTo, "R.box");
    const r = stageBox(rel);
    const bx = rel instanceof HTMLElement && rel !== stage ? rel.clientLeft : 0;
    const by = rel instanceof HTMLElement && rel !== stage ? rel.clientTop : 0;
    return { x: b.x - r.x - bx, y: b.y - r.y - by, w: b.w, h: b.h };
  }
  const sides = { center: [0.5, 0.5], left: [0, 0.5], right: [1, 0.5], top: [0.5, 0], bottom: [0.5, 1], "top-left": [0, 0], "top-right": [1, 0], "bottom-left": [0, 1], "bottom-right": [1, 1] };
  const normals = { left: [-1, 0], right: [1, 0], top: [0, -1], bottom: [0, 1] };
  function point(target, side, relativeTo) {
    if (Array.isArray(target)) return { x: target[0], y: target[1] };
    if (target && typeof target.x === "number" && typeof target.y === "number" && !(target instanceof Element)) return target;
    const b = box(target, relativeTo);
    const f = Array.isArray(side) ? side : sides[side || "center"];
    if (!f) throw new Error("R.point: unknown side " + side);
    return { x: b.x + b.w * f[0], y: b.y + b.h * f[1] };
  }

  // ------------------------------------------------------------ strokes
  const layers = new WeakMap();
  function layer(parent, above) {
    const host = resolve(parent || stage, "R.layer");
    const key = above ? "above" : "below";
    const cache = layers.get(host) || {};
    if (cache[key] && cache[key].isConnected) return cache[key];
    const svg = document.createElementNS(NS, "svg");
    svg.setAttribute("class", "r-layer");
    svg.setAttribute("width", String(Math.max(1, host === stage ? config.stage.width : host.offsetWidth)));
    svg.setAttribute("height", String(Math.max(1, host === stage ? config.stage.height : host.offsetHeight)));
    svg.style.zIndex = above ? "50" : "0";
    if (above || !host.firstChild) host.appendChild(svg); else host.insertBefore(svg, host.firstChild);
    cache[key] = svg; layers.set(host, cache);
    return svg;
  }
  function svgEl(tag, attributes, parent) {
    const el = document.createElementNS(NS, tag);
    for (const k in attributes) if (attributes[k] !== undefined && attributes[k] !== null) el.setAttribute(k, String(attributes[k]));
    if (parent) parent.appendChild(el);
    return el;
  }
  const f1 = (n) => Math.round(n * 10) / 10;
  function pathFromPoints(points, smooth) {
    if (!smooth || points.length < 3) return "M" + points.map((p) => f1(p[0]) + " " + f1(p[1])).join(" L");
    let d = "M" + f1(points[0][0]) + " " + f1(points[0][1]);
    for (let i = 0; i < points.length - 1; i++) {
      const p0 = points[i - 1] || points[i], p1 = points[i], p2 = points[i + 1], p3 = points[i + 2] || p2;
      const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
      const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
      d += " C" + f1(c1[0]) + " " + f1(c1[1]) + ", " + f1(c2[0]) + " " + f1(c2[1]) + ", " + f1(p2[0]) + " " + f1(p2[1]);
    }
    return d;
  }
  // A drawable stroke: draw() reveals it from start to end (arrowheads ride
  // the tip), flow() sends packets along it.
  function stroke(d, options) {
    const o = options || {};
    const host = o.layer ? layer(o.layer, o.above) : layer(stage, o.above);
    const color = o.color || "var(--r-accent)";
    const width = o.width || 4;
    const group = svgEl("g", { class: "r-stroke" + (o.className ? " " + o.className : "") }, host);
    if (o.opacity !== undefined) group.setAttribute("opacity", String(o.opacity));
    const path = svgEl("path", { d, fill: "none", stroke: color, "stroke-width": width, "stroke-linecap": "round", "stroke-linejoin": "round" }, group);
    if (o.glow) path.style.filter = "drop-shadow(0 0 " + (o.glow === true ? 8 : o.glow) + "px " + (o.glowColor || color) + ")";
    let length = path.getTotalLength();
    let mask;
    if (o.dash) {
      path.setAttribute("stroke-dasharray", o.dash);
      const id = "r-mask-" + Math.floor(Math.random() * 1e9).toString(36);
      const m = svgEl("mask", { id, maskUnits: "userSpaceOnUse", x: -10000, y: -10000, width: 20000, height: 20000 }, group);
      mask = svgEl("path", { d, fill: "none", stroke: "#fff", "stroke-width": width + 8, "stroke-linecap": "round", "stroke-linejoin": "round", "stroke-dasharray": length + " " + (length + 1) }, m);
      path.setAttribute("mask", "url(#" + id + ")");
    } else {
      path.setAttribute("stroke-dasharray", length + " " + (length + 1));
    }
    const heads = [];
    const headSize = o.headSize || Math.max(14, width * 4);
    const makeHead = () => svgEl("path", { d: "M" + -headSize + " " + -headSize * 0.55 + " L0 0 L" + -headSize + " " + headSize * 0.55 + (o.head === "line" ? "" : " Z"), fill: o.head === "line" ? "none" : color, stroke: color, "stroke-width": o.head === "line" ? width : 1, "stroke-linejoin": "round", "stroke-linecap": "round" }, group);
    if (o.arrow === true || o.arrow === "end" || o.arrow === "both") heads.push({ el: makeHead(), at: "end" });
    if (o.arrow === "start" || o.arrow === "both") heads.push({ el: makeHead(), at: "start" });
    const pointAt = (t) => { const p = path.getPointAtLength(clamp(t, 0, 1) * length); return { x: p.x, y: p.y }; };
    const angleAt = (t, dir) => {
      const e = Math.min(2, length / 4) / length;
      const a = pointAt(clamp(t - e, 0, 1)), b = pointAt(clamp(t + e, 0, 1));
      return Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI + (dir < 0 ? 180 : 0);
    };
    let progress = 1;
    // Strokes routed from elements re-measure them when their draw starts,
    // so text that grew meanwhile (a counter, typed code) is still framed.
    const reshape = (next) => {
      if (!next || next === d) return;
      d = next;
      path.setAttribute("d", d);
      length = path.getTotalLength();
      const dash = length + " " + (length + 1);
      if (mask) { mask.setAttribute("d", d); mask.setAttribute("stroke-dasharray", dash); }
      else path.setAttribute("stroke-dasharray", dash);
    };
    const apply = (p) => {
      progress = p;
      const offset = length * (1 - p);
      (mask || path).setAttribute("stroke-dashoffset", String(offset));
      for (const h of heads) {
        const visible = p > 0.001;
        const t = h.at === "end" ? p : 0;
        const at = pointAt(t);
        const s = clamp(p * length / (headSize * 1.5), 0, 1);
        h.el.setAttribute("transform", "translate(" + f1(at.x) + " " + f1(at.y) + ") rotate(" + f1(angleAt(t, h.at === "end" ? 1 : -1)) + ") scale(" + s.toFixed(3) + ")");
        h.el.style.opacity = visible ? "1" : "0";
      }
    };
    apply(o.hidden ? 0 : 1);
    const api = {
      group, path, heads: heads.map((h) => h.el), pointAt, angleAt,
      get length() { return length; },
      get d() { return d; },
      get progress() { return progress; },
      set(p) { apply(clamp(p, 0, 1)); return api; },
      // Timeline that draws the stroke; it is hidden until the draw starts.
      draw(opts) {
        const q = opts || {};
        const proxy = { p: q.from === undefined ? 0 : q.from };
        apply(proxy.p);
        return gsap.to(proxy, { p: q.to === undefined ? 1 : q.to, duration: q.duration || 0.8, ease: q.ease || "power2.inOut", onStart: () => { if (o.geometry) reshape(o.geometry()); }, onUpdate: () => apply(proxy.p) });
      },
      undraw(opts) {
        const q = opts || {};
        const proxy = { p: 1 };
        return gsap.fromTo(proxy, { p: 1 }, { p: 0, duration: q.duration || 0.6, ease: q.ease || "power2.in", onUpdate: () => apply(proxy.p), immediateRender: false });
      },
      flow(opts) { return flow(api, opts); },
    };
    return api;
  }
  function autoSide(a, b) {
    const dx = b.x + b.w / 2 - (a.x + a.w / 2), dy = b.y + b.h / 2 - (a.y + a.h / 2);
    if (Math.abs(dx) * 0.75 >= Math.abs(dy)) return dx >= 0 ? ["right", "left"] : ["left", "right"];
    return dy >= 0 ? ["bottom", "top"] : ["top", "bottom"];
  }
  // Connector between two elements (or [x, y] points), routed from their real
  // layout boxes: R.connect(".api", ".db", { arrow: true }).draw()
  const isPoint = (t) => Array.isArray(t) || (t && typeof t.x === "number" && !(t instanceof Element));
  // Nearest positioned container holding all targets, so strokes drawn there
  // move with the elements (for example inside a camera container).
  function container(targets) {
    const els = targets.filter((t) => !isPoint(t)).map((t) => resolve(t, "R"));
    if (!els.length || els.some((e) => !(e instanceof HTMLElement))) return stage;
    let host = els[0].offsetParent;
    while (host && host !== stage && !els.every((e) => host.contains(e))) host = host.offsetParent;
    return host && stage.contains(host) ? host : stage;
  }
  function connect(a, b, options) {
    const o = Object.assign({ arrow: true, curve: "curve", gap: 10 }, options || {});
    if (!o.layer) o.layer = container([a, b]);
    const rel = o.layer === stage ? undefined : resolve(o.layer, "R.connect");
    const route = () => {
    const ab = isPoint(a) ? null : box(a, rel), bb = isPoint(b) ? null : box(b, rel);
    const pa = isPoint(a) ? point(a) : null, pb = isPoint(b) ? point(b) : null;
    let [sa, sb] = ab && bb ? autoSide(ab, bb) : ["center", "center"];
    if (o.from && o.from !== "auto") sa = o.from;
    if (o.to && o.to !== "auto") sb = o.to;
    if (!ab && bb && (!o.to || o.to === "auto")) sb = autoSide({ x: pa.x, y: pa.y, w: 0, h: 0 }, bb)[1];
    if (ab && !bb && (!o.from || o.from === "auto")) sa = autoSide(ab, { x: pb.x, y: pb.y, w: 0, h: 0 })[0];
    const end = (bx, p, side, gap) => {
      if (!bx) return { p: { x: p.x, y: p.y }, n: [0, 0] };
      const f = Array.isArray(side) ? side : sides[side] || sides.center;
      const n = normals[side] || [0, 0];
      return { p: { x: bx.x + bx.w * f[0] + n[0] * gap, y: bx.y + bx.h * f[1] + n[1] * gap }, n };
    };
    const A = end(ab, pa, sa, o.gap), B = end(bb, pb, sb, o.gap + (o.arrow === true || o.arrow === "end" || o.arrow === "both" ? 2 : 0));
    const p0 = A.p, p3 = B.p;
    const dist = Math.hypot(p3.x - p0.x, p3.y - p0.y);
    let d;
    if (o.curve === "straight") d = "M" + f1(p0.x) + " " + f1(p0.y) + " L" + f1(p3.x) + " " + f1(p3.y);
    else if (o.curve === "elbow") {
      const r = o.radius === undefined ? 24 : o.radius;
      const horizontal = A.n[0] !== 0 || (A.n[1] === 0 && Math.abs(p3.x - p0.x) >= Math.abs(p3.y - p0.y));
      const pts = horizontal
        ? [[p0.x, p0.y], [(p0.x + p3.x) / 2, p0.y], [(p0.x + p3.x) / 2, p3.y], [p3.x, p3.y]]
        : [[p0.x, p0.y], [p0.x, (p0.y + p3.y) / 2], [p3.x, (p0.y + p3.y) / 2], [p3.x, p3.y]];
      if ((horizontal && B.n[1] !== 0) || (!horizontal && B.n[0] !== 0)) { pts.splice(1, 2, horizontal ? [p3.x, p0.y] : [p0.x, p3.y]); }
      d = "M" + f1(pts[0][0]) + " " + f1(pts[0][1]);
      for (let i = 1; i < pts.length - 1; i++) {
        const prev = pts[i - 1], cur = pts[i], next = pts[i + 1];
        const l1 = Math.hypot(cur[0] - prev[0], cur[1] - prev[1]), l2 = Math.hypot(next[0] - cur[0], next[1] - cur[1]);
        const rr = Math.min(r, l1 / 2, l2 / 2);
        if (rr < 0.5) { d += " L" + f1(cur[0]) + " " + f1(cur[1]); continue; }
        const a1 = [cur[0] - (cur[0] - prev[0]) / l1 * rr, cur[1] - (cur[1] - prev[1]) / l1 * rr];
        const a2 = [cur[0] + (next[0] - cur[0]) / l2 * rr, cur[1] + (next[1] - cur[1]) / l2 * rr];
        d += " L" + f1(a1[0]) + " " + f1(a1[1]) + " Q" + f1(cur[0]) + " " + f1(cur[1]) + " " + f1(a2[0]) + " " + f1(a2[1]);
      }
      d += " L" + f1(p3.x) + " " + f1(p3.y);
    } else if (o.curve === "arc" || typeof o.bend === "number") {
      const bend = typeof o.bend === "number" ? o.bend : 0.25;
      const mx = (p0.x + p3.x) / 2, my = (p0.y + p3.y) / 2;
      const nx = -(p3.y - p0.y), ny = p3.x - p0.x;
      d = "M" + f1(p0.x) + " " + f1(p0.y) + " Q" + f1(mx + nx * bend) + " " + f1(my + ny * bend) + " " + f1(p3.x) + " " + f1(p3.y);
    } else {
      const k = clamp(dist * (o.tension === undefined ? 0.45 : o.tension), 30, 420);
      const n0 = A.n[0] || A.n[1] ? A.n : [Math.sign(p3.x - p0.x) || 1, 0];
      const n3 = B.n[0] || B.n[1] ? B.n : [-(Math.sign(p3.x - p0.x) || 1), 0];
      d = "M" + f1(p0.x) + " " + f1(p0.y) + " C" + f1(p0.x + n0[0] * k) + " " + f1(p0.y + n0[1] * k) + ", " + f1(p3.x + n3[0] * k) + " " + f1(p3.y + n3[1] * k) + ", " + f1(p3.x) + " " + f1(p3.y);
    }
    return d;
    };
    return stroke(route(), Object.assign({}, o, { geometry: route }));
  }
  // Glowing packets travelling along a stroke or an SVG <path>.
  // Returns a timeline: tl.add(R.flow(link, { count: 3 }), 2)
  function flow(target, options) {
    const o = Object.assign({ count: 3, duration: 1.2, size: 9, glow: true, ease: "none" }, options || {});
    let path, parent;
    if (target && target.path && target.group) { path = target.path; parent = target.group; }
    else { path = resolve(target, "R.flow"); parent = path.parentNode; }
    const length = path.getTotalLength();
    const color = o.color || path.getAttribute("stroke") || "var(--r-accent)";
    const every = o.every || o.stagger || (o.count > 1 ? o.duration / o.count : o.duration);
    const total = o.until ? Math.max(1, Math.floor(Math.max(0, o.until - o.duration) / every) + 1) : o.count;
    const tl = gsap.timeline();
    for (let i = 0; i < total; i++) {
      const dot = svgEl("circle", { r: o.size, fill: color, class: "r-packet" }, parent);
      if (o.glow) dot.style.filter = "drop-shadow(0 0 " + Math.round(o.size * 1.4) + "px " + color + ")";
      dot.style.opacity = "0";
      const proxy = { p: 0 };
      const place = () => {
        const t = o.reverse ? 1 - proxy.p : proxy.p;
        const at = path.getPointAtLength(clamp(t, 0, 1) * length);
        dot.setAttribute("cx", f1(at.x)); dot.setAttribute("cy", f1(at.y));
        dot.style.opacity = proxy.p <= 0 || proxy.p >= 1 ? "0" : String(clamp(Math.min(proxy.p, 1 - proxy.p) / 0.06, 0, 1));
      };
      tl.to(proxy, { p: 1, duration: o.duration, ease: o.ease, onUpdate: place }, i * every);
    }
    return tl;
  }
  // Polyline or SVG path data through stage points: R.line([[100,500],[400,300]], {smooth: true})
  function line(points, options) {
    const o = options || {};
    const d = typeof points === "string" ? points : pathFromPoints(points.map((p) => Array.isArray(p) ? p : [p.x, p.y]), o.smooth);
    return stroke(d, Object.assign({ arrow: false }, o));
  }
  // Rounded outline drawn around an element, for emphasis.
  function ring(target, options) {
    const o = Object.assign({ pad: 14, radius: 22, width: 3, glow: true, arrow: false }, options || {});
    if (!o.layer) o.layer = container([target]);
    const rel = o.layer === stage ? undefined : resolve(o.layer, "R.ring");
    const outline = () => {
    const b = box(target, rel);
    const x = b.x - o.pad, y = b.y - o.pad, w = b.w + o.pad * 2, h = b.h + o.pad * 2, r = Math.min(o.radius, w / 2, h / 2);
    const d = "M" + f1(x + w / 2) + " " + f1(y) + " H" + f1(x + w - r) + " Q" + f1(x + w) + " " + f1(y) + " " + f1(x + w) + " " + f1(y + r) +
      " V" + f1(y + h - r) + " Q" + f1(x + w) + " " + f1(y + h) + " " + f1(x + w - r) + " " + f1(y + h) + " H" + f1(x + r) +
      " Q" + f1(x) + " " + f1(y + h) + " " + f1(x) + " " + f1(y + h - r) + " V" + f1(y + r) + " Q" + f1(x) + " " + f1(y) + " " + f1(x + r) + " " + f1(y) + " Z";
    return d;
    };
    return stroke(outline(), Object.assign({ above: true }, o, { geometry: outline }));
  }

  // ------------------------------------------------------------ elements
  function el(tag, options) {
    const o = options || {};
    const node = document.createElement(tag || "div");
    if (o.className || o.class) node.className = o.className || o.class;
    if (o.text !== undefined) node.textContent = o.text;
    if (o.html !== undefined) node.innerHTML = o.html;
    if (o.style) css(node, o.style);
    if (o.attrs) for (const k in o.attrs) node.setAttribute(k, o.attrs[k]);
    resolve(o.parent || stage, "R.el").appendChild(node);
    return node;
  }
  // A labelled diagram node: R.node({ x: 300, y: 400, label: "API", icon: "server", sub: "Node.js" })
  function node(options) {
    const o = Object.assign({ w: 0, h: 0 }, options || {});
    const n = el("div", { parent: o.parent, className: "r-node" + (o.column ? " r-column" : "") + (o.shape === "pill" ? " r-pill" : o.shape === "circle" ? " r-circle" : "") + (o.className ? " " + o.className : "") });
    if (o.color) n.style.setProperty("--r-accent", o.color);
    if (o.icon) { const i = document.createElement("div"); i.className = "r-icon"; i.innerHTML = icon(o.icon, { size: o.iconSize || (o.column ? 56 : 44), color: o.color || "currentColor", strokeWidth: 1.8 }); n.appendChild(i); }
    if (o.label !== undefined || o.sub !== undefined) {
      const t = document.createElement("div"); t.className = "r-text";
      if (o.label !== undefined) { const l = document.createElement("div"); l.className = "r-label"; l.textContent = o.label; t.appendChild(l); }
      if (o.sub !== undefined) { const s = document.createElement("div"); s.className = "r-sub"; s.textContent = o.sub; t.appendChild(s); }
      n.appendChild(t);
    }
    if (o.html) n.insertAdjacentHTML("beforeend", o.html);
    if (o.w) n.style.width = o.w + "px";
    if (o.h) n.style.height = o.h + "px"; else if (!o.column && o.shape !== "circle") n.style.height = "96px";
    if (o.shape === "circle" && o.w && !o.h) n.style.height = o.w + "px";
    if (o.fontSize) n.style.fontSize = o.fontSize + "px";
    if (o.style) css(n, o.style);
    const w = n.offsetWidth, h = n.offsetHeight;
    const ax = o.anchor === "top-left" ? 0 : 0.5, ay = o.anchor === "top-left" ? 0 : 0.5;
    n.style.left = f1((o.x || 0) - w * ax) + "px";
    n.style.top = f1((o.y || 0) - h * ay) + "px";
    return n;
  }

  // ------------------------------------------------------------ code
  const keywords = {
    sql: "select from where and or not in is null as join left right inner outer full cross on group by order having limit offset insert into values update set delete create table index unique primary key foreign references alter drop add column view with recursive union all distinct case when then else end begin commit rollback transaction explain analyze returning default constraint if exists using desc asc count sum avg min max serial bigint int integer text varchar boolean timestamp timestamptz jsonb uuid vacuum btree hash gin gist lateral over partition window",
    js: "const let var function return if else for while do switch case break continue new class extends super this import export from default async await try catch finally throw typeof instanceof in of yield null undefined true false void delete static get set interface type implements enum readonly public private protected",
    python: "def return if elif else for while in not and or is None True False class import from as with try except finally raise lambda yield async await pass break continue global nonlocal assert del print self",
    go: "func return if else for range switch case default break continue go defer chan select struct interface map package import var const type nil true false make new len cap append error string int bool byte",
    rust: "fn let mut return if else for while loop match struct enum impl trait pub use mod crate self Self super where as in move ref async await dyn const static true false Some None Ok Err String Vec Option Result",
    bash: "if then else fi for do done while case esac function return export local echo cd ls cat grep sudo apt npm npx git docker kubectl curl psql",
    json: "true false null",
  };
  keywords.ts = keywords.js; keywords.typescript = keywords.js; keywords.javascript = keywords.js; keywords.py = keywords.python; keywords.sh = keywords.bash; keywords.shell = keywords.bash; keywords.postgres = keywords.sql; keywords.postgresql = keywords.sql;
  function highlight(source, lang) {
    const language = (lang || "js").toLowerCase();
    const words = new Set((keywords[language] || keywords.js).split(" "));
    const caseless = language === "sql" || language === "postgres" || language === "postgresql";
    const comment = language === "sql" ? "--[^\\n]*|\\/\\*[\\s\\S]*?\\*\\/" : language === "python" || language === "bash" || language === "sh" || language === "py" || language === "shell" ? "#[^\\n]*" : "\\/\\/[^\\n]*|\\/\\*[\\s\\S]*?\\*\\/";
    const re = new RegExp("(" + comment + ")|(\"(?:[^\"\\\\\\n]|\\\\.)*\"|'(?:[^'\\\\\\n]|\\\\.)*'|\\x60[^\\x60]*\\x60)|(\\b\\d[\\d_]*(?:\\.\\d+)?(?:e[+-]?\\d+)?\\b)|([A-Za-z_$][\\w$]*)|(\\s+)|([^\\sA-Za-z_$\\d])", "g");
    let out = "", m, last = "";
    while ((m = re.exec(source))) {
      const [text, c, s, n, w, ws] = m;
      if (c) out += '<span class="tk-c">' + escape(c) + "</span>";
      else if (s) out += '<span class="tk-s">' + escape(s) + "</span>";
      else if (n) out += '<span class="tk-n">' + n + "</span>";
      else if (w) {
        const next = source.slice(re.lastIndex).match(/^\s*\(/);
        const cls = words.has(caseless ? w.toLowerCase() : w) ? "tk-k" : next ? "tk-f" : /^[A-Z]/.test(w) && !caseless ? "tk-t" : last === "." ? "tk-v" : "";
        out += cls ? '<span class="' + cls + '">' + escape(w) + "</span>" : escape(w);
      } else if (ws) out += ws;
      else out += '<span class="tk-p">' + escape(text) + "</span>";
      if (!ws) last = text;
    }
    return out;
  }
  // Syntax-highlighted code in an element, with typing and line highlights:
  // const c = R.code(".editor", "SELECT * FROM users;", { lang: "sql" }); tl.add(c.type(), 0.5)
  function code(target, source, options) {
    const o = options || {};
    const host = resolve(target, "R.code");
    host.classList.add("r-code");
    if (getComputedStyle(host).position === "static") host.style.position = "relative";
    if (o.lineNumbers) host.classList.add("r-numbered");
    if (o.fontSize) host.style.fontSize = o.fontSize + "px";
    const html = highlight(String(source).replace(/\t/g, "  "), o.lang);
    // Split highlighted HTML into lines, closing/reopening spans that cross newlines.
    const lines = []; let current = "", open = [];
    html.split(/(<span class="[^"]*">|<\/span>|\n)/).forEach((part) => {
      if (!part) return;
      if (part === "\n") { lines.push(current + "</span>".repeat(open.length)); current = open.join(""); return; }
      if (part.startsWith("<span")) open.push(part); else if (part === "</span>") open.pop();
      current += part;
    });
    lines.push(current);
    host.innerHTML = lines.map((l, i) => '<span class="r-ln" data-n="' + (i + 1) + '">' + (l || " ") + "</span>").join("");
    const lineEls = [...host.querySelectorAll(".r-ln")];
    let chars = null, caret = null, shown = -1;
    const splitChars = () => {
      if (chars) return chars;
      chars = [];
      const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT);
      const texts = []; let t;
      while ((t = walker.nextNode())) texts.push(t);
      for (const text of texts) {
        const frag = document.createDocumentFragment();
        for (const ch of text.data) { const s = document.createElement("span"); s.className = "r-ch"; s.textContent = ch; frag.appendChild(s); chars.push(s); }
        text.parentNode.replaceChild(frag, text);
      }
      return chars;
    };
    const api = {
      element: host, lines: lineEls,
      // Types the code character by character (with a caret) over the duration.
      type(opts) {
        const q = opts || {};
        const list = splitChars();
        if (q.caret !== false && !caret) { caret = document.createElement("span"); caret.className = "r-caret"; }
        const show = (count) => {
          const n = Math.round(clamp(count, 0, list.length));
          if (n === shown) return;
          for (let i = 0; i < list.length; i++) list[i].style.visibility = i < n ? "visible" : "hidden";
          shown = n;
          if (caret) {
            if (n >= list.length && q.keepCaret !== true) caret.remove();
            else if (n === 0) lineEls[0].insertBefore(caret, lineEls[0].firstChild);
            else list[n - 1].after(caret);
          }
        };
        const proxy = { n: 0 };
        show(0);
        const duration = q.duration || (q.speed ? list.length / q.speed : Math.min(3, list.length * 0.035));
        return gsap.to(proxy, { n: list.length, duration, ease: "none", onUpdate: () => show(proxy.n) });
      },
      // Lines fade/slide in one after another.
      reveal(opts) {
        const q = opts || {};
        return gsap.from(lineEls, { opacity: 0, x: q.x === undefined ? -24 : q.x, duration: q.duration || 0.5, stagger: q.stagger || 0.12, ease: q.ease || "power3.out" });
      },
      // Highlight bar behind line(s) (0-based index or [from, to]).
      highlight(index, opts) {
        const q = opts || {};
        const [a, b] = Array.isArray(index) ? index : [index, index];
        const top = lineEls[a].offsetTop, bottom = lineEls[b].offsetTop + lineEls[b].offsetHeight;
        const bar = document.createElement("div"); bar.className = "r-hl";
        if (q.color) bar.style.setProperty("--r-accent", q.color);
        bar.style.top = top - 2 + "px"; bar.style.height = bottom - top + 4 + "px";
        host.insertBefore(bar, host.firstChild);
        return gsap.from(bar, { scaleX: 0, transformOrigin: "0 50%", opacity: 0, duration: q.duration || 0.45, ease: q.ease || "power3.out" });
      },
    };
    return api;
  }

  // ------------------------------------------------------------ numbers & charts
  const format = (v, o) => {
    const fixed = v.toFixed(o.decimals || 0);
    const [i, f] = fixed.split(".");
    const sep = o.separator === undefined ? "," : o.separator;
    return (o.prefix || "") + i.replace(/\B(?=(\d{3})+(?!\d))/g, sep) + (f ? "." + f : "") + (o.suffix || "");
  };
  // Counts an element's text up to a number: tl.add(R.count(".users", 1200000, { suffix: "+" }), 1)
  function count(target, to, options) {
    const o = Object.assign({ from: 0, duration: 1.2, ease: "power2.out" }, options || {});
    const n = resolve(target, "R.count");
    const proxy = { v: o.from };
    n.textContent = format(o.from, o);
    return gsap.to(proxy, { v: to, duration: o.duration, ease: o.ease, onUpdate: () => { n.textContent = format(proxy.v, o); } });
  }
  // Bar chart: const chart = R.bars({ x, y, w, h, data: [{ label, value, color }] }); tl.add(chart.grow(), 1)
  function bars(options) {
    const o = Object.assign({ gap: 0.35, showValues: true, horizontal: false, labelSpace: 52 }, options || {});
    const data = o.data || [];
    const max = o.max || Math.max(...data.map((d) => d.value), 1);
    const wrap = el("div", { parent: o.parent, className: "r-bars" + (o.horizontal ? " r-horizontal" : "") + (o.className ? " " + o.className : ""), style: { left: o.x || 0, top: o.y || 0, width: o.w || 800, height: o.h || 400 } });
    const W = o.w || 800, H = o.h || 400, n = data.length || 1;
    const items = data.map((d, i) => {
      const color = d.color || "var(--r-accent-" + ((i % 6) + 1) + ")";
      const bar = el("div", { parent: wrap, className: "r-bar", style: { background: color } });
      const label = el("div", { parent: wrap, className: "r-bar-label", text: d.label === undefined ? "" : d.label });
      const value = o.showValues ? el("div", { parent: wrap, className: "r-bar-value", text: format(d.value, o) }) : null;
      if (!o.horizontal) {
        const slot = W / n, bw = slot * (1 - o.gap), bh = Math.max(6, (H - o.labelSpace) * d.value / max);
        css(bar, { left: slot * i + (slot - bw) / 2, width: bw, top: H - o.labelSpace - bh, height: bh, transformOrigin: "50% 100%" });
        css(label, { left: slot * i, width: slot, top: H - o.labelSpace + 12 });
        if (value) css(value, { left: slot * i, width: slot, top: H - o.labelSpace - bh - 42 });
      } else {
        const slot = H / n, bh = slot * (1 - o.gap), labelW = o.labelWidth || 200, bw = Math.max(6, (W - labelW - 120) * d.value / max);
        css(bar, { left: labelW, width: bw, top: slot * i + (slot - bh) / 2, height: bh, transformOrigin: "0% 50%" });
        css(label, { left: 0, width: labelW - 20, top: slot * i + slot / 2 - 16, textAlign: "right" });
        if (value) css(value, { left: labelW + bw + 16, top: slot * i + slot / 2 - 18, textAlign: "left" });
      }
      return { bar, label, value, data: d };
    });
    return {
      element: wrap, items,
      grow(opts) {
        const q = opts || {};
        const tl = gsap.timeline();
        items.forEach((it, i) => {
          const at = i * (q.stagger === undefined ? 0.12 : q.stagger);
          tl.from(it.bar, o.horizontal ? { scaleX: 0, duration: q.duration || 0.9, ease: q.ease || "power3.out" } : { scaleY: 0, duration: q.duration || 0.9, ease: q.ease || "power3.out" }, at);
          tl.from(it.label, { opacity: 0, y: 10, duration: 0.4 }, at);
          if (it.value) { tl.from(it.value, { opacity: 0, duration: 0.3 }, at + 0.2); tl.add(count(it.value, it.data.value, Object.assign({}, o, { duration: q.duration || 0.9, ease: q.ease || "power3.out" })), at); }
        });
        return tl;
      },
    };
  }

  // ------------------------------------------------------------ camera & ambience
  // Moves a container (the "world") so a target inside it is centred, zoomed:
  // tl.add(R.focus(".world", ".db", { scale: 1.8 }), 6); R.focus(".world", null) resets.
  function focus(camera, target, options) {
    const o = Object.assign({ scale: 1.6, duration: 1.2, ease: "power3.inOut" }, options || {});
    const world = resolve(camera, "R.focus");
    world.setAttribute("data-r-camera", "");
    gsap.set(world, { transformOrigin: "0 0" });
    if (!target) return gsap.to(world, { x: 0, y: 0, scale: 1, duration: o.duration, ease: o.ease });
    const c = box(world), t = box(target, world);
    const at = o.at || [config.stage.width / 2, config.stage.height / 2];
    const s = o.scale;
    return gsap.to(world, { x: at[0] - c.x - s * (t.x + t.w / 2), y: at[1] - c.y - s * (t.y + t.h / 2), scale: s, duration: o.duration, ease: o.ease });
  }
  function grid(options) {
    const o = Object.assign({ size: 64, color: "rgba(148,163,184,0.09)", fade: true }, options || {});
    const g = el("div", { parent: o.parent, className: "r-grid" });
    g.style.backgroundImage = o.dots
      ? "radial-gradient(" + o.color + " 1.6px, transparent 1.8px)"
      : "linear-gradient(" + o.color + " 1px, transparent 1px), linear-gradient(90deg, " + o.color + " 1px, transparent 1px)";
    g.style.backgroundSize = o.size + "px " + o.size + "px";
    if (o.fade) g.style.maskImage = g.style.webkitMaskImage = "radial-gradient(ellipse at 50% 45%, #000 35%, transparent 80%)";
    if (o.drift) gsap.fromTo(g, { backgroundPosition: "0px 0px" }, { backgroundPosition: "0px " + o.size + "px", duration: Math.max(1, config.duration), ease: "none" });
    return g;
  }
  function glow(options) {
    const o = Object.assign({ x: config.stage.width / 2, y: config.stage.height / 2, size: 700, color: "var(--r-accent)", opacity: 0.35 }, options || {});
    const g = el("div", { parent: o.parent, className: "r-glow", style: { left: o.x - o.size / 2, top: o.y - o.size / 2, width: o.size, height: o.size, background: o.color, opacity: o.opacity } });
    if (o.drift !== false) gsap.to(g, { x: R.range(-60, 60), y: R.range(-40, 40), scale: R.range(0.9, 1.15), duration: Math.max(1, config.duration), ease: "sine.inOut" });
    return g;
  }
  // Slowly drifting specks for depth; continuous for the whole scene.
  function particles(options) {
    const o = Object.assign({ count: 40, color: "#94a3b8", size: [1.5, 4], opacity: [0.15, 0.6], speed: 18 }, options || {});
    const area = o.area || [0, 0, config.stage.width, config.stage.height];
    const wrap = el("div", { parent: o.parent, className: "r-particles", style: { position: "absolute", inset: 0, pointerEvents: "none" } });
    const list = [];
    for (let i = 0; i < o.count; i++) {
      const s = R.range(o.size[0], o.size[1]);
      const p = el("div", { parent: wrap, className: "r-particle", style: { width: s, height: s, left: area[0] + R.range(0, area[2]), top: area[1] + R.range(0, area[3]), background: o.color, opacity: R.range(o.opacity[0], o.opacity[1]) } });
      const angle = R.range(0, Math.PI * 2), distance = o.speed * Math.max(1, config.duration) * R.range(0.4, 1);
      gsap.to(p, { x: Math.cos(angle) * distance, y: Math.sin(angle) * distance - o.speed * 0.3 * config.duration, duration: Math.max(1, config.duration), ease: "none" });
      list.push(p);
    }
    return wrap;
  }
  // Applies the film's style guide as CSS variables (--r-bg, --r-surface, --r-text,
  // --r-muted, --r-accent, --r-accent-1…6, --r-display, --r-body) and the stage background.
  function theme(t) {
    const o = t || {};
    const set = (k, v) => { if (v) frame.style.setProperty(k, v); };
    set("--r-bg", o.background); set("--r-surface", o.surface); set("--r-text", o.text); set("--r-muted", o.muted);
    (o.accents || []).forEach((c, i) => set("--r-accent-" + (i + 1), c));
    if (o.accents && o.accents[0]) set("--r-accent", o.accents[0]);
    if (o.displayFont) set("--r-display", "'" + o.displayFont + "'");
    if (o.bodyFont) set("--r-body", "'" + o.bodyFont + "'");
    if (o.background) frame.style.background = o.background;
    if (o.text) frame.style.color = o.text;
    if (o.bodyFont) frame.style.fontFamily = "'" + o.bodyFont + "', sans-serif";
    return R;
  }
  function accent(i) {
    return getComputedStyle(stage).getPropertyValue("--r-accent-" + ((((i || 0) % 6) + 6) % 6 + 1)).trim();
  }
  function icon(name, options) {
    const o = options || {};
    const nodes = icons[name];
    if (!nodes) throw new Error("Unknown icon: " + name);
    const size = o.size || 48;
    return '<svg xmlns="http://www.w3.org/2000/svg" width="' + size + '" height="' + size +
      '" viewBox="0 0 24 24" fill="none" stroke="' + escape(o.color || "currentColor") +
      '" stroke-width="' + (o.strokeWidth || 2) + '" stroke-linecap="round" stroke-linejoin="round"' +
      (o.className ? ' class="' + escape(o.className) + '"' : "") + ">" + nodes.map(iconNode).join("") + "</svg>";
  }


  // ------------------------------------------------------------ 3D (three.js)
  // A lit 3D scene drawn into a canvas on the stage, once per frame. Needs
  // <libraries>three</libraries>. Animate meshes, lights and the camera with
  // GSAP like any object: gsap.to(mesh.rotation, { y: Math.PI, duration: 3 }).
  function three(options) {
    const T = window.THREE;
    if (!T) throw new Error("R.three needs <libraries>three</libraries> in the scene.");
    const o = Object.assign({ fov: 35, camera: [0, 1.2, 9], target: [0, 0, 0], environment: true, exposure: 1, light: 1.2, bloom: false, background: null, shadows: false }, options || {});
    const host = resolve(o.parent || stage, "R.three");
    const w = o.w || (host === stage ? config.stage.width : host.offsetWidth);
    const h = o.h || (host === stage ? config.stage.height : host.offsetHeight);
    const canvas = document.createElement("canvas");
    canvas.className = "r-three";
    css(canvas, { position: "absolute", left: o.x || 0, top: o.y || 0, width: w, height: h, pointerEvents: "none" });
    if (o.front) host.appendChild(canvas); else host.insertBefore(canvas, host.firstChild);
    const renderer = new T.WebGLRenderer({ canvas, antialias: true, alpha: !o.background, preserveDrawingBuffer: true });
    // Draw at the output's resolution (the stage is scaled to the output).
    const ratio = Math.min(1, frame.getBoundingClientRect().width / config.stage.width || 1);
    renderer.setPixelRatio(ratio);
    renderer.setSize(w, h, false);
    renderer.toneMapping = T.ACESFilmicToneMapping;
    renderer.toneMappingExposure = o.exposure;
    renderer.outputColorSpace = T.SRGBColorSpace;
    if (o.shadows) { renderer.shadowMap.enabled = true; renderer.shadowMap.type = T.PCFSoftShadowMap; }
    const scene = new T.Scene();
    if (o.background) scene.background = new T.Color(o.background);
    if (o.fog) scene.fog = new T.Fog(new T.Color(o.fog.color || o.background || "#000000"), o.fog.near || 8, o.fog.far || 40);
    if (o.environment) {
      const pmrem = new T.PMREMGenerator(renderer);
      scene.environment = pmrem.fromScene(new T.RoomEnvironment(), 0.04).texture;
      scene.environmentIntensity = o.environmentIntensity === undefined ? 0.45 : o.environmentIntensity;
      pmrem.dispose();
    }
    const camera = new T.PerspectiveCamera(o.fov, w / h, 0.1, 400);
    camera.position.set(o.camera[0], o.camera[1], o.camera[2]);
    const target = new T.Vector3(o.target[0], o.target[1], o.target[2]);
    const key = new T.DirectionalLight(0xffffff, o.light);
    key.position.set(5, 8, 6);
    if (o.shadows) { key.castShadow = true; key.shadow.mapSize.set(2048, 2048); key.shadow.camera.left = key.shadow.camera.bottom = -12; key.shadow.camera.right = key.shadow.camera.top = 12; }
    scene.add(key);
    const rim = new T.DirectionalLight(0x88aaff, o.light * 0.6);
    rim.position.set(-6, 3, -6);
    scene.add(rim);
    scene.add(new T.AmbientLight(0xffffff, 0.2));
    let composer = null;
    if (o.bloom) {
      const b = o.bloom === true ? {} : o.bloom;
      composer = new T.EffectComposer(renderer);
      composer.setPixelRatio(ratio);
      composer.setSize(w, h);
      composer.addPass(new T.RenderPass(scene, camera));
      composer.addPass(new T.UnrealBloomPass(new T.Vector2(w, h), b.strength === undefined ? 0.6 : b.strength, b.radius === undefined ? 0.5 : b.radius, b.threshold === undefined ? 0.85 : b.threshold));
      composer.addPass(new T.OutputPass());
    }
    const draw = () => { camera.lookAt(target); if (composer) composer.render(); else renderer.render(scene, camera); };
    (window.__reelchemyDraw = window.__reelchemyDraw || []).push(draw);
    const color = (c) => new T.Color(c && c.startsWith && c.startsWith("var(") ? getComputedStyle(frame).getPropertyValue(c.slice(4, -1)).trim() || "#ffffff" : c || "#ffffff");
    const material = (m) => {
      const q = m || {};
      return new T.MeshPhysicalMaterial({
        color: color(q.color || "#e2e8f0"), metalness: q.metalness === undefined ? 0.2 : q.metalness, roughness: q.roughness === undefined ? 0.35 : q.roughness,
        clearcoat: q.clearcoat === undefined ? 0.6 : q.clearcoat, clearcoatRoughness: 0.2,
        emissive: color(q.emissive || "#000000"), emissiveIntensity: q.emissiveIntensity === undefined ? 1 : q.emissiveIntensity,
        transmission: q.glass ? 1 : 0, thickness: q.glass ? 0.6 : 0, ior: 1.4,
        transparent: q.opacity !== undefined && q.opacity < 1, opacity: q.opacity === undefined ? 1 : q.opacity,
        side: q.doubleSide ? T.DoubleSide : T.FrontSide,
      });
    };
    const place = (mesh, q) => {
      if (q.position) mesh.position.set(q.position[0], q.position[1], q.position[2]);
      if (q.rotation) mesh.rotation.set(q.rotation[0], q.rotation[1], q.rotation[2]);
      if (q.scale !== undefined) mesh.scale.setScalar(q.scale);
      if (o.shadows) { mesh.castShadow = true; mesh.receiveShadow = true; }
      (q.parent || scene).add(mesh);
      return mesh;
    };
    // A canvas-drawn texture at 4x the stage resolution for crisp text.
    const canvasPlane = (pxWidth, pxHeight, paint, q) => {
      const k = 2;
      const c = document.createElement("canvas");
      c.width = Math.ceil(pxWidth * k); c.height = Math.ceil(pxHeight * k);
      const ctx = c.getContext("2d");
      ctx.scale(k, k);
      paint(ctx);
      const texture = new T.CanvasTexture(c);
      texture.colorSpace = T.SRGBColorSpace;
      texture.anisotropy = 8;
      const worldWidth = q.width || pxWidth / 160;
      // Kept just under the bloom threshold unless the card should glow.
      const tint = q.glow ? 1 : 0.82;
      const mesh = new T.Mesh(new T.PlaneGeometry(worldWidth, worldWidth * pxHeight / pxWidth), new T.MeshBasicMaterial({ map: texture, color: new T.Color(tint, tint, tint), transparent: true, toneMapped: false, side: T.DoubleSide }));
      return place(mesh, q);
    };
    const roundRect = (ctx, x, y, w, h, r) => { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); };
    const api = {
      THREE: T, scene, camera, renderer, canvas, target, draw,
      add(obj) { scene.add(obj); return obj; },
      group(q) { return place(new T.Group(), q || {}); },
      material,
      // A rounded box (cards, devices, servers): R.three(...).box({ w: 3, h: 2, d: 0.3, radius: 0.12, color: "#1e293b" })
      box(q) {
        const b = Object.assign({ w: 1, h: 1, d: 1, radius: 0.08 }, q || {});
        return place(new T.Mesh(new T.RoundedBoxGeometry(b.w, b.h, b.d, 6, Math.min(b.radius, b.w / 2, b.h / 2, b.d / 2)), material(b)), b);
      },
      sphere(q) {
        const b = Object.assign({ r: 0.5 }, q || {});
        return place(new T.Mesh(new T.SphereGeometry(b.r, 64, 32), material(b)), b);
      },
      cylinder(q) {
        const b = Object.assign({ r: 0.5, h: 1 }, q || {});
        return place(new T.Mesh(new T.CylinderGeometry(b.rTop === undefined ? b.r : b.rTop, b.r, b.h, 64), material(b)), b);
      },
      // Extrudes filled SVG path data (a logo or shape), centred, "size" world units wide.
      extrude(d, q) {
        const b = Object.assign({ depth: 0.25, size: 2, bevel: 0.03 }, q || {});
        // Even-odd filling cuts holes whatever the subpaths' direction.
        const data = new T.SVGLoader().parse('<svg xmlns="http://www.w3.org/2000/svg"><path fill-rule="evenodd" d="' + escape(d) + '"/></svg>');
        const shapes = data.paths.flatMap((p) => T.SVGLoader.createShapes(p));
        const geometry = new T.ExtrudeGeometry(shapes, { depth: 1, bevelEnabled: b.bevel > 0, bevelThickness: 0.06, bevelSize: 0.04, bevelSegments: 4, curveSegments: 24 });
        geometry.computeBoundingBox();
        const bb = geometry.boundingBox, width = bb.max.x - bb.min.x || 1;
        geometry.translate(-(bb.min.x + bb.max.x) / 2, -(bb.min.y + bb.max.y) / 2, -0.5);
        const k = b.size / width;
        geometry.scale(k, k, b.depth);
        // SVG y points down: turn it over (a negative scale would flip faces).
        geometry.rotateX(Math.PI);
        return place(new T.Mesh(geometry, material(b)), b);
      },
      // A crisp text card in 3D space (canvas texture): label("PostgreSQL", { size: 64, width: 3 })
      label(text, q) {
        const b = Object.assign({ size: 64, weight: 700, font: "Space Grotesk", color: "#ffffff", padding: 0, radius: 24 }, q || {});
        const measure = document.createElement("canvas").getContext("2d");
        const font = b.weight + " " + b.size + 'px "' + b.font + '"';
        measure.font = font;
        const lines = String(text).split("\n");
        const tw = Math.max(...lines.map((l) => measure.measureText(l).width)) + b.padding * 2;
        const lh = b.size * 1.15, th = lh * lines.length + b.padding * 2;
        return canvasPlane(tw, th, (ctx) => {
          if (b.background) { ctx.fillStyle = b.background; roundRect(ctx, 0, 0, tw, th, b.radius); ctx.fill(); }
          ctx.font = font; ctx.fillStyle = b.color; ctx.textBaseline = "middle"; ctx.textAlign = b.align || "left";
          const x = b.align === "center" ? tw / 2 : b.align === "right" ? tw - b.padding : b.padding;
          lines.forEach((l, i) => ctx.fillText(l, x, b.padding + lh * (i + 0.5)));
        }, Object.assign({ width: tw / 160 }, b));
      },
      // A Lucide icon on a card (or bare) in 3D space.
      icon(name, q) {
        const b = Object.assign({ px: 256, color: "#ffffff", strokeWidth: 1.6, width: 1 }, q || {});
        const nodes = icons[name];
        if (!nodes) throw new Error("Unknown icon: " + name);
        return canvasPlane(b.px, b.px, (ctx) => {
          if (b.background) { ctx.fillStyle = b.background; roundRect(ctx, 0, 0, b.px, b.px, b.px * 0.22); ctx.fill(); }
          const pad = b.background ? b.px * 0.2 : 0, k = (b.px - pad * 2) / 24;
          ctx.translate(pad, pad); ctx.scale(k, k);
          ctx.strokeStyle = b.color; ctx.lineWidth = b.strokeWidth; ctx.lineCap = "round"; ctx.lineJoin = "round";
          for (const [tag, a] of nodes) {
            ctx.beginPath();
            if (tag === "path") { ctx.stroke(new Path2D(a.d)); continue; }
            if (tag === "circle") ctx.arc(+a.cx, +a.cy, +a.r, 0, Math.PI * 2);
            else if (tag === "ellipse") ctx.ellipse(+a.cx, +a.cy, +a.rx, +a.ry, 0, 0, Math.PI * 2);
            else if (tag === "rect") roundRect(ctx, +a.x, +a.y, +a.width, +a.height, +(a.rx || 0));
            else if (tag === "line") { ctx.moveTo(+a.x1, +a.y1); ctx.lineTo(+a.x2, +a.y2); }
            else if (tag === "polyline" || tag === "polygon") {
              const pts = String(a.points).trim().split(/[\s,]+/).map(Number);
              for (let i = 0; i < pts.length; i += 2) i ? ctx.lineTo(pts[i], pts[i + 1]) : ctx.moveTo(pts[i], pts[i + 1]);
              if (tag === "polygon") ctx.closePath();
            }
            ctx.stroke();
          }
        }, b);
      },
      // A project image as a flat picture in 3D (screens, product shots, logos).
      image(id, q) {
        const b = Object.assign({ width: 3, radius: 0 }, q || {});
        const img = assetImages[id];
        if (!img) throw new Error("Image " + id + " is not attached to this scene.");
        const texture = new T.Texture(img);
        texture.colorSpace = T.SRGBColorSpace;
        texture.anisotropy = 8;
        texture.needsUpdate = true;
        const ratio = (img.naturalHeight || 1) / (img.naturalWidth || 1);
        const material = new T.MeshBasicMaterial({ map: texture, transparent: true, toneMapped: false, side: T.DoubleSide });
        const tint = b.glow ? 1 : 0.9;
        material.color.setRGB(tint, tint, tint);
        return place(new T.Mesh(new T.PlaneGeometry(b.width, b.width * ratio), material), b);
      },
      // Floating points of light (seeded): particles({ count: 400, spread: [20, 10, 20] })
      particles(q) {
        const b = Object.assign({ count: 300, spread: [20, 10, 20], size: 0.04, color: "#93c5fd", opacity: 0.8 }, q || {});
        const positions = new Float32Array(b.count * 3);
        for (let i = 0; i < b.count; i++) for (let j = 0; j < 3; j++) positions[i * 3 + j] = (Math.random() - 0.5) * b.spread[j];
        const geometry = new T.BufferGeometry();
        geometry.setAttribute("position", new T.BufferAttribute(positions, 3));
        return place(new T.Points(geometry, new T.PointsMaterial({ color: color(b.color), size: b.size, transparent: true, opacity: b.opacity, depthWrite: false, blending: T.AdditiveBlending })), b);
      },
      // A glossy floor with a faint grid, for objects to stand on.
      floor(q) {
        const b = Object.assign({ size: 60, y: -1, color: "#0b1020", grid: "#1e293b" }, q || {});
        const g = new T.Group();
        const plane = new T.Mesh(new T.PlaneGeometry(b.size, b.size), new T.MeshStandardMaterial({ color: color(b.color), roughness: b.roughness === undefined ? 0.8 : b.roughness, metalness: 0, envMapIntensity: 0.25 }));
        plane.rotation.x = -Math.PI / 2;
        if (o.shadows) plane.receiveShadow = true;
        g.add(plane);
        if (b.grid) { const grid = new T.GridHelper(b.size, b.size, color(b.grid), color(b.grid)); grid.position.y = 0.002; grid.material.transparent = true; grid.material.opacity = 0.5; g.add(grid); }
        g.position.y = b.y;
        scene.add(g);
        return g;
      },
      // Tween that circles the camera around the target: tl.add(view.orbit({ from: -30, to: 30, duration: 6 }), 0)
      orbit(q) {
        const b = Object.assign({ from: 0, to: 360, duration: 8, ease: "sine.inOut" }, q || {});
        const dx = camera.position.x - target.x, dz = camera.position.z - target.z;
        const radius = b.radius || Math.hypot(dx, dz), height = b.height === undefined ? camera.position.y : b.height;
        const proxy = { a: b.from };
        const set = () => { const r = proxy.a * Math.PI / 180; camera.position.set(target.x + Math.sin(r) * radius, height, target.z + Math.cos(r) * radius); };
        set();
        return gsap.to(proxy, { a: b.to, duration: b.duration, ease: b.ease, onUpdate: set });
      },
      // Where a 3D point (or object) appears on the stage, in stage pixels, to
      // pin HTML labels to 3D objects.
      screen(p) {
        const v = p && p.isObject3D ? p.getWorldPosition(new T.Vector3()) : new T.Vector3(p[0], p[1], p[2]);
        camera.updateMatrixWorld();
        camera.lookAt(target);
        v.project(camera);
        return { x: (o.x || 0) + (v.x + 1) / 2 * w, y: (o.y || 0) + (1 - v.y) / 2 * h };
      },
    };
    return api;
  }

  // A film finish over everything: animated grain, a vignette and optional
  // letterbox bars. The grain moves with the frame time (not Math.random), so
  // preview and export match. R.finish({ grain: 0.06, vignette: 0.45, letterbox: 0 })
  function finish(options) {
    const o = Object.assign({ grain: 0.06, vignette: 0.45, letterbox: 0 }, options || {});
    const layer = document.createElement("div");
    layer.className = "r-finish";
    css(layer, { position: "absolute", left: 0, top: 0, width: config.stage.width, height: config.stage.height, pointerEvents: "none", zIndex: 1000 });
    frame.appendChild(layer);
    if (o.vignette > 0) {
      const v = document.createElement("div");
      css(v, { position: "absolute", inset: 0, background: "radial-gradient(ellipse at 50% 50%, rgba(0,0,0,0) 52%, rgba(0,0,0," + o.vignette + ") 100%)" });
      layer.appendChild(v);
    }
    if (o.grain > 0) {
      const size = 256, c = document.createElement("canvas");
      c.width = c.height = size;
      const ctx = c.getContext("2d"), data = ctx.createImageData(size, size);
      let seed = 1234567;
      for (let i = 0; i < data.data.length; i += 4) {
        seed = (seed * 1664525 + 1013904223) >>> 0;
        const v = seed >>> 24;
        data.data[i] = data.data[i + 1] = data.data[i + 2] = v;
        data.data[i + 3] = 255;
      }
      ctx.putImageData(data, 0, 0);
      const g = document.createElement("div");
      css(g, { position: "absolute", inset: 0, backgroundImage: 'url("' + c.toDataURL() + '")', backgroundSize: size + "px " + size + "px", opacity: o.grain, mixBlendMode: "overlay" });
      layer.appendChild(g);
      (window.__reelchemyDraw = window.__reelchemyDraw || []).push((now) => {
        const f = Math.round(now / (1000 / config.fps));
        const h = Math.imul(f + 1, 2654435761) >>> 0;
        g.style.backgroundPosition = (h % size) + "px " + ((h >>> 8) % size) + "px";
      });
    }
    if (o.letterbox > 0) {
      for (const top of [true, false]) {
        const bar = document.createElement("div");
        css(bar, { position: "absolute", left: 0, right: 0, height: o.letterbox, background: "#000", top: top ? 0 : "auto", bottom: top ? "auto" : 0 });
        layer.appendChild(bar);
      }
    }
    return layer;
  }

  // A project image attached to this scene: its URL, or a new <img>.
  function asset(id) {
    if (!assetUrls[id]) throw new Error("Image " + id + " is not attached to this scene.");
    return assetUrls[id];
  }
  function image(id, options) {
    const o = options || {};
    const img = el("img", { parent: o.parent, className: o.className, style: o.style, attrs: { src: asset(id), alt: "" } });
    return img;
  }

  const R = window.R = {
    width: config.stage.width,
    height: config.stage.height,
    fps: config.fps,
    duration: config.duration,
    stage,
    random: Math.random,
    range: (min, max) => min + Math.random() * (max - min),
    pick: (list) => list[Math.floor(Math.random() * list.length)],
    icon,
    iconNames: () => Object.keys(icons),
    theme, accent, el, node, box, point, layer,
    connect, line, ring, flow, code, highlight, count, bars, focus, grid, glow, particles,
    asset, image, assetIds: (config.assets || []).slice(), finish,
    three,
  };
  if (window.gsap) {
    gsap.registerPlugin(...${JSON.stringify(gsapPlugins)}.map((name) => window[name]).filter(Boolean));
    gsap.ticker.lagSmoothing(0);
    window.__reelchemyFlush = () => gsap.ticker.tick();
  }
})();`;
