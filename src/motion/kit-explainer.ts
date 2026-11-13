// Explainer building blocks for the motion kit: multi-shot scenes with
// transitions, labelled arrows, callouts, hand-drawn emphasis, step lists,
// UI mockups with a cursor, line/area charts, stat cards, isometric stacks
// and kinetic type. Inserted into KIT_SOURCE (same closure, so it uses the
// kit's layout-aware helpers). Plain ES2020 with no template literals: this
// source is itself embedded in a template.
export const KIT_EXPLAINER_SOURCE = String.raw`
  const explainerStyle = document.createElement("style");
  explainerStyle.textContent = [
    ".r-shot{position:absolute;left:0;top:0;overflow:hidden}",
    ".r-tag{position:absolute;padding:8px 18px;border-radius:999px;background:color-mix(in srgb,var(--r-surface) 92%,transparent);border:2px solid color-mix(in srgb,var(--r-accent) 70%,transparent);color:var(--r-text);font:600 24px var(--r-mono);white-space:nowrap;z-index:60;box-shadow:0 10px 30px rgba(0,0,0,.35)}",
    ".r-callout{position:absolute;max-width:520px;padding:16px 22px;border-radius:16px;background:color-mix(in srgb,var(--r-surface) 94%,transparent);border:2px solid color-mix(in srgb,var(--r-accent) 60%,transparent);color:var(--r-text);font:500 26px/1.3 var(--r-body);z-index:60;box-shadow:0 18px 50px rgba(0,0,0,.4)}",
    ".r-callout b{display:block;font:700 28px var(--r-display);color:var(--r-accent);margin-bottom:4px}",
    ".r-marker{position:absolute;border-radius:6px;background:color-mix(in srgb,var(--r-accent) 34%,transparent);z-index:-1;transform-origin:0 50%}",
    ".r-steps{position:absolute;display:flex;flex-direction:column}",
    ".r-step{position:relative;display:flex;align-items:center;gap:26px}",
    ".r-step-badge{flex:none;display:flex;align-items:center;justify-content:center;width:68px;height:68px;border-radius:50%;font:700 30px var(--r-mono);color:var(--r-text);background:color-mix(in srgb,var(--r-accent) calc(var(--r-on, 0) * 100%),var(--r-surface));border:2px solid color-mix(in srgb,var(--r-accent) 70%,transparent);box-shadow:0 0 calc(var(--r-on, 0) * 40px) color-mix(in srgb,var(--r-accent) 60%,transparent);z-index:1}",
    ".r-step-text{display:flex;flex-direction:column;gap:4px;opacity:calc(.42 + .58 * var(--r-on, 0))}",
    ".r-step-title{font:600 36px var(--r-display);color:var(--r-text)}",
    ".r-step-sub{font:400 24px var(--r-body);color:var(--r-muted)}",
    ".r-step-rail{position:absolute;left:33px;width:4px;border-radius:2px;background:color-mix(in srgb,var(--r-muted) 30%,transparent);z-index:0}",
    ".r-step-fill{position:absolute;left:0;top:0;width:100%;border-radius:2px;background:var(--r-accent);transform-origin:50% 0}",
    ".r-win{position:absolute;display:flex;flex-direction:column;border-radius:22px;overflow:hidden;background:var(--r-surface);border:1.5px solid rgba(255,255,255,.12);box-shadow:0 40px 120px rgba(0,0,0,.55),0 0 0 1px rgba(0,0,0,.4)}",
    ".r-win.r-light{background:#ffffff;border-color:rgba(15,23,42,.12);box-shadow:0 40px 120px rgba(15,23,42,.25)}",
    ".r-win-bar{flex:none;display:flex;align-items:center;gap:12px;height:64px;padding:0 22px;background:color-mix(in srgb,var(--r-surface) 70%,#000);border-bottom:1px solid rgba(255,255,255,.08)}",
    ".r-win.r-light .r-win-bar{background:#f1f5f9;border-bottom-color:rgba(15,23,42,.08)}",
    ".r-win-dots{display:flex;gap:10px}.r-win-dots i{width:16px;height:16px;border-radius:50%;background:#ff5f57}.r-win-dots i:nth-child(2){background:#febc2e}.r-win-dots i:nth-child(3){background:#28c840}",
    ".r-win-url{flex:1;display:flex;align-items:center;gap:10px;height:40px;margin:0 30px;padding:0 18px;border-radius:12px;background:rgba(255,255,255,.07);color:var(--r-muted);font:500 22px var(--r-mono);white-space:nowrap;overflow:hidden}",
    ".r-win.r-light .r-win-url{background:#ffffff;color:#475569;border:1px solid rgba(15,23,42,.1)}",
    ".r-win-title{flex:1;text-align:center;color:var(--r-muted);font:600 22px var(--r-body);margin-right:66px}",
    ".r-win-body{position:relative;flex:1;overflow:hidden}",
    ".r-win.r-terminal{background:#0b0f19}.r-win.r-terminal .r-win-body{padding:28px 32px;font:500 28px/1.55 var(--r-mono);color:#e2e8f0}",
    ".r-win.r-phone{border-radius:64px;border:14px solid #111827;box-shadow:0 0 0 2px rgba(255,255,255,.12),0 50px 140px rgba(0,0,0,.6)}",
    ".r-win.r-phone .r-win-bar{height:54px;justify-content:center;background:transparent;border:0}",
    ".r-win.r-phone .r-win-bar::before{content:'';width:140px;height:34px;border-radius:20px;background:#111827}",
    ".r-cursor{position:absolute;width:44px;height:44px;z-index:200;pointer-events:none;filter:drop-shadow(0 6px 10px rgba(0,0,0,.45))}",
    ".r-ripple{position:absolute;width:24px;height:24px;margin:-12px 0 0 -12px;border-radius:50%;border:3px solid var(--r-accent);z-index:199;pointer-events:none}",
    ".r-chart{position:absolute}.r-chart svg{position:absolute;left:0;top:0;overflow:visible}",
    ".r-present-shadow{position:absolute;pointer-events:none;border-radius:50%;background:radial-gradient(closest-side,rgba(0,0,0,.6),transparent);filter:blur(16px)}.r-present-sheen{position:absolute;inset:0;pointer-events:none;border-radius:inherit;z-index:3;background:linear-gradient(115deg,transparent 35%,rgba(255,255,255,.13) 48%,rgba(255,255,255,.04) 56%,transparent 64%);background-size:260% 100%;mix-blend-mode:screen}",
    ".r-shine{position:absolute;inset:0;overflow:hidden;pointer-events:none;border-radius:inherit;z-index:3}.r-shine i{position:absolute;top:-60%;left:0;height:220%;mix-blend-mode:screen}",
    ".r-chart-label{position:absolute;font:500 22px var(--r-body);color:var(--r-muted);white-space:nowrap;transform:translateX(-50%)}",
    ".r-chart-value{position:absolute;padding:6px 14px;border-radius:10px;background:var(--r-accent);color:var(--r-bg);font:700 26px var(--r-mono);white-space:nowrap;transform:translate(-50%,-140%)}",
    ".r-stat{position:absolute;display:flex;flex-direction:column;gap:6px;padding:28px 34px;border-radius:24px;background:color-mix(in srgb,var(--r-surface) 90%,transparent);border:2px solid color-mix(in srgb,var(--r-accent) 45%,transparent);box-shadow:0 24px 70px rgba(0,0,0,.4)}",
    ".r-stat-value{font:700 76px/1 var(--r-display);color:var(--r-accent);letter-spacing:-.02em;white-space:nowrap}",
    ".r-stat-label{font:500 26px var(--r-body);color:var(--r-muted);white-space:nowrap}",
    ".r-iso{position:absolute;left:0;top:0;overflow:visible}",
    ".r-iso-label{position:absolute;display:flex;align-items:center;gap:14px;font:600 30px var(--r-display);color:var(--r-text);white-space:nowrap}",
    ".r-iso-label small{font:500 22px var(--r-mono);color:var(--r-muted)}",
    ".r-swap{position:relative;display:inline-block;vertical-align:bottom;overflow:hidden}",
    ".r-swap > span{position:absolute;left:0;top:0;white-space:nowrap}",
  ].join("\n");
  document.head.insertBefore(explainerStyle, style.nextSibling);

  const W = config.stage.width, H = config.stage.height;
  const hostOf = (targets, given) => given ? resolve(given, "R") : container(targets);
  const relOf = (host) => host === stage ? undefined : host;

  // ------------------------------------------------------------ shots
  // Several full-stage shots in one scene, each entering with a transition:
  // tl.add(R.shots([".s1", ".s2", ".s3"], { at: [0, 4.5, 9], transition: "push" }), 0)
  // Transitions: push, slide-up, zoom (through), wipe, blur, fade, cut.
  function shots(list, options) {
    const o = Object.assign({ transition: "push", duration: 0.8, ease: "power3.inOut" }, options || {});
    const els = list.map((s) => resolve(s, "R.shots"));
    const at = o.at || els.map((_, i) => (config.duration / els.length) * i);
    els.forEach((e) => {
      e.classList.add("r-shot");
      e.setAttribute("data-r-camera", "");
      css(e, { width: W, height: H });
    });
    const tl = gsap.timeline();
    els.forEach((e, i) => tl.set(e, { autoAlpha: i === 0 ? 1 : 0 }, 0));
    for (let i = 1; i < els.length; i++) {
      const prev = els[i - 1], next = els[i];
      const kind = Array.isArray(o.transition) ? o.transition[i - 1] || "push" : o.transition;
      const d = kind === "cut" ? 0.001 : o.duration, t = Math.max(0, at[i] - (kind === "cut" ? 0 : d * 0.5));
      const ease = o.ease;
      tl.set(next, { autoAlpha: 1 }, t);
      if (kind === "push") {
        tl.fromTo(prev, { x: 0 }, { x: -W, duration: d, ease, immediateRender: false }, t)
          .fromTo(next, { x: W }, { x: 0, duration: d, ease, immediateRender: false }, t);
      } else if (kind === "slide-up") {
        tl.fromTo(prev, { y: 0 }, { y: -H, duration: d, ease, immediateRender: false }, t)
          .fromTo(next, { y: H }, { y: 0, duration: d, ease, immediateRender: false }, t);
      } else if (kind === "zoom") {
        tl.fromTo(prev, { scale: 1, opacity: 1 }, { scale: 2.2, opacity: 0, duration: d, ease: "power3.in", transformOrigin: "50% 50%", immediateRender: false }, t)
          .fromTo(next, { scale: 0.6, opacity: 0 }, { scale: 1, opacity: 1, duration: d, ease: "power3.out", transformOrigin: "50% 50%", immediateRender: false }, t + d * 0.35);
      } else if (kind === "wipe") {
        next.style.zIndex = String(10 + i);
        tl.fromTo(next, { clipPath: "inset(0% 0% 0% 100%)" }, { clipPath: "inset(0% 0% 0% 0%)", duration: d, ease, immediateRender: false }, t)
          .fromTo(prev, { x: 0 }, { x: -W * 0.18, duration: d, ease, immediateRender: false }, t);
      } else if (kind === "blur") {
        tl.fromTo(prev, { filter: "blur(0px)", opacity: 1 }, { filter: "blur(24px)", opacity: 0, duration: d, ease, immediateRender: false }, t)
          .fromTo(next, { filter: "blur(24px)", opacity: 0, scale: 1.06 }, { filter: "blur(0px)", opacity: 1, scale: 1, duration: d, ease, immediateRender: false }, t);
      } else if (kind === "fade") {
        tl.fromTo(prev, { opacity: 1 }, { opacity: 0, duration: d, ease: "none", immediateRender: false }, t)
          .fromTo(next, { opacity: 0 }, { opacity: 1, duration: d, ease: "none", immediateRender: false }, t);
      }
      tl.set(prev, { autoAlpha: 0 }, t + d + (kind === "zoom" ? d * 0.35 : 0));
    }
    return tl;
  }

  // ------------------------------------------------------------ arrows & callouts
  // A connector with a label riding on it: R.arrow(".api", ".db", { label: "SQL query" })
  function arrow(a, b, options) {
    const o = Object.assign({ labelAt: 0.5, arrow: true }, options || {});
    const host = hostOf([a, b], o.layer);
    const link = connect(a, b, Object.assign({}, o, { layer: host }));
    let tag = null;
    const placeTag = () => {
      if (!tag) return;
      const p = link.pointAt(o.labelAt);
      gsap.set(tag, { left: p.x, top: p.y, xPercent: -50, yPercent: -50 });
    };
    if (o.label) {
      tag = el("div", { parent: host, className: "r-tag", text: o.label });
      if (o.color) tag.style.setProperty("--r-accent", o.color);
      placeTag();
    }
    return Object.assign({}, link, {
      label: tag,
      draw(q) {
        const d = (q && q.duration) || 0.8;
        const tl = gsap.timeline();
        tl.add(link.draw(q), 0);
        if (tag) tl.fromTo(tag, { opacity: 0, scale: 0.6 }, { opacity: 1, scale: 1, duration: 0.45, ease: "back.out(2)", onStart: placeTag }, d * o.labelAt);
        return tl;
      },
      // The arrow and its label fade together.
      hide(q) { return gsap.timeline().add(link.hide(q), 0).to(tag || {}, { opacity: 0, duration: (q && q.duration) || 0.3 }, 0); },
      show(q) { return gsap.timeline().add(link.show(q), 0).to(tag || {}, { opacity: 1, duration: (q && q.duration) || 0.3 }, 0); },
    });
  }
  const callDirs = { right: [1, 0], left: [-1, 0], top: [0, -1], bottom: [0, 1], "top-right": [0.75, -0.66], "top-left": [-0.75, -0.66], "bottom-right": [0.75, 0.66], "bottom-left": [-0.75, 0.66] };
  // A note pointing at an element: R.callout(".db", { title: "Cache miss", text: "Read from disk", side: "right" })
  function callout(target, options) {
    const o = Object.assign({ side: "right", distance: 120 }, options || {});
    const host = hostOf([target], o.parent);
    const rel = relOf(host);
    const dir = callDirs[o.side] || callDirs.right;
    const note = el("div", { parent: host, className: "r-callout" + (o.className ? " " + o.className : ""), html: (o.title ? "<b>" + escape(o.title) + "</b>" : "") + escape(o.text || "") });
    if (o.color) note.style.setProperty("--r-accent", o.color);
    if (o.width) note.style.width = o.width + "px";
    let anchor, end;
    const layout = () => {
      const b = box(target, rel);
      const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
      anchor = { x: cx + dir[0] * (b.w / 2 + 6), y: cy + dir[1] * (b.h / 2 + 6) };
      end = { x: anchor.x + dir[0] * o.distance, y: anchor.y + dir[1] * o.distance };
      const w = note.offsetWidth, h = note.offsetHeight;
      const left = dir[0] > 0.1 ? end.x : dir[0] < -0.1 ? end.x - w : end.x - w / 2;
      const top = dir[1] > 0.1 ? end.y : dir[1] < -0.1 ? end.y - h : end.y - h / 2;
      css(note, { left: f1(left), top: f1(top) });
      return "M" + f1(anchor.x) + " " + f1(anchor.y) + " L" + f1(end.x) + " " + f1(end.y);
    };
    const leader = stroke(layout(), { layer: host, above: true, color: o.color || "var(--r-accent)", width: 3, arrow: false, geometry: layout });
    const dot = svgEl("circle", { r: 7, fill: o.color || "var(--r-accent)", cx: f1(anchor.x), cy: f1(anchor.y) }, leader.group);
    return {
      element: note, line: leader, dot,
      show(q) {
        const tl = gsap.timeline();
        tl.fromTo(dot, { scale: 0, transformOrigin: "50% 50%" }, { scale: 1, duration: 0.3, ease: "back.out(3)", onStart: () => { layout(); dot.setAttribute("cx", f1(anchor.x)); dot.setAttribute("cy", f1(anchor.y)); } }, 0)
          .add(leader.draw({ duration: 0.4 }), 0.1)
          .fromTo(note, { opacity: 0, x: dir[0] * -24, y: dir[1] * -24 }, { opacity: 1, x: 0, y: 0, duration: 0.5, ease: "power3.out" }, 0.35);
        return tl;
      },
      hide(q) {
        return gsap.to([note, leader.group], { opacity: 0, duration: (q && q.duration) || 0.3 });
      },
    };
  }
  // Hand-drawn emphasis: R.mark(".word", { style: "underline" | "circle" | "box" | "marker" })
  function mark(target, options) {
    const o = Object.assign({ style: "underline", width: 5, pad: 12 }, options || {});
    const host = hostOf([target], o.layer);
    const rel = relOf(host);
    if (o.style === "marker") {
      const b = box(target, rel);
      const m = el("div", { parent: host, className: "r-marker", style: { left: b.x - 6, top: b.y + b.h * 0.18, width: b.w + 12, height: b.h * 0.72 } });
      if (o.color) m.style.background = o.color;
      if (getComputedStyle(resolve(target)).position === "static") resolve(target).style.position = "relative";
      gsap.set(m, { scaleX: 0 });
      return { element: m, draw(q) { return gsap.to(m, { scaleX: 1, duration: (q && q.duration) || 0.5, ease: "power2.out" }); } };
    }
    const shape = () => {
      const b = box(target, rel), p = o.pad;
      if (o.style === "underline") {
        const y = b.y + b.h + p * 0.6;
        return "M" + f1(b.x - 4) + " " + f1(y + 3) + " C" + f1(b.x + b.w * 0.3) + " " + f1(y - 5) + ", " + f1(b.x + b.w * 0.7) + " " + f1(y + 6) + ", " + f1(b.x + b.w + 6) + " " + f1(y - 2);
      }
      if (o.style === "circle") {
        const cx = b.x + b.w / 2, cy = b.y + b.h / 2, rx = b.w / 2 + p * 1.6, ry = b.h / 2 + p * 1.4;
        const pts = [];
        for (let i = 0; i <= 40; i++) {
          const a = -Math.PI * 0.6 + (i / 40) * Math.PI * 2.12;
          const wob = 1 + Math.sin(i * 1.7) * 0.025;
          pts.push([cx + Math.cos(a) * rx * wob, cy + Math.sin(a) * ry * wob]);
        }
        return pathFromPoints(pts, true);
      }
      const x = b.x - p, y = b.y - p, w = b.w + p * 2, h = b.h + p * 2;
      return pathFromPoints([[x + 4, y + 2], [x + w - 2, y - 2], [x + w + 2, y + h - 3], [x - 2, y + h + 2], [x + 2, y - 4]], false);
    };
    return stroke(shape(), { layer: host, above: true, color: o.color || "var(--r-accent)", width: o.width, arrow: false, geometry: shape, hidden: true });
  }

  // ------------------------------------------------------------ steps
  // A numbered step list that reveals and advances:
  // const s = R.steps({ x: 120, y: 260, items: ["Request", { title: "Cache", sub: "miss" }] }); tl.add(s.reveal(), 0.5).add(s.activate(0), 1)
  function steps(options) {
    const o = Object.assign({ x: 120, y: 200, gap: 34, numbered: true }, options || {});
    const wrap = el("div", { parent: o.parent, className: "r-steps", style: { left: o.x, top: o.y, gap: o.gap } });
    if (o.w) wrap.style.width = o.w + "px";
    const rail = el("div", { parent: wrap, className: "r-step-rail" });
    const fill = el("div", { parent: rail, className: "r-step-fill" });
    const rows = (o.items || []).map((item, i) => {
      const it = typeof item === "string" ? { title: item } : item;
      const row = el("div", { parent: wrap, className: "r-step" });
      const badge = el("div", { parent: row, className: "r-step-badge", html: it.icon ? icon(it.icon, { size: 34 }) : escape(String(o.numbered ? i + 1 : "")) });
      const text = el("div", { parent: row, className: "r-step-text" });
      el("div", { parent: text, className: "r-step-title", text: it.title || "" });
      if (it.sub) el("div", { parent: text, className: "r-step-sub", text: it.sub });
      row.style.setProperty("--r-on", "0");
      return { row, badge };
    });
    const centre = (i) => rows[i].row.offsetTop + rows[i].badge.offsetTop + rows[i].badge.offsetHeight / 2;
    if (rows.length > 1) css(rail, { top: centre(0), height: centre(rows.length - 1) - centre(0) });
    gsap.set(fill, { scaleY: 0, height: "100%" });
    return {
      element: wrap, rows: rows.map((r) => r.row),
      reveal(q) {
        const s = (q && q.stagger) || 0.18;
        return gsap.timeline().from(rows.map((r) => r.row), { opacity: 0, x: -40, duration: 0.6, stagger: s, ease: "power3.out" }).from(rail, { opacity: 0, duration: 0.4 }, 0);
      },
      // Lights step i (earlier steps stay done), with the rail filling to it.
      activate(i, q) {
        const d = (q && q.duration) || 0.5;
        const tl = gsap.timeline();
        rows.forEach((r, j) => tl.to(r.row, { "--r-on": j <= i ? (j === i ? 1 : 0.6) : 0, duration: d, ease: "power2.out" }, 0));
        tl.fromTo(rows[i].badge, { scale: 1 }, { scale: 1.18, duration: d * 0.45, yoyo: true, repeat: 1, ease: "power2.out" }, 0);
        if (rows.length > 1) tl.to(fill, { scaleY: i / (rows.length - 1), duration: d, ease: "power2.inOut" }, 0);
        return tl;
      },
    };
  }

  // ------------------------------------------------------------ UI mockups
  // A browser, app, terminal or phone frame with a content area:
  // const win = R.window({ kind: "browser", x: 960, y: 560, w: 1200, h: 720, url: "shop.example.com" }); win.body.innerHTML = "...";
  function uiWindow(options) {
    const o = Object.assign({ kind: "browser", w: 1200, h: 720 }, options || {});
    if (o.kind === "phone") { o.w = options && options.w || 430; o.h = options && options.h || 880; }
    const win = el("div", { parent: o.parent, className: "r-win r-" + o.kind + (o.light ? " r-light" : "") + (o.className ? " " + o.className : ""), style: { width: o.w, height: o.h } });
    const anchorTopLeft = o.anchor === "top-left";
    css(win, { left: (o.x === undefined ? W / 2 : o.x) - (anchorTopLeft ? 0 : o.w / 2), top: (o.y === undefined ? H / 2 : o.y) - (anchorTopLeft ? 0 : o.h / 2) });
    const bar = el("div", { parent: win, className: "r-win-bar" });
    let url = null;
    if (o.kind !== "phone") el("div", { parent: bar, className: "r-win-dots", html: "<i></i><i></i><i></i>" });
    if (o.kind === "browser") {
      url = el("div", { parent: bar, className: "r-win-url", html: icon("lock", { size: 20 }) + "<span></span>" });
      url.querySelector("span").textContent = o.url || "";
    } else if (o.kind === "app" || o.kind === "terminal") el("div", { parent: bar, className: "r-win-title", text: o.title || (o.kind === "terminal" ? "zsh" : "") });
    const body = el("div", { parent: win, className: "r-win-body" });
    return {
      element: win, bar, body,
      open(q) {
        return gsap.fromTo(win, { opacity: 0, y: 60, scale: 0.94 }, { opacity: 1, y: 0, scale: 1, duration: (q && q.duration) || 0.8, ease: "expo.out" });
      },
      // Types into the address bar.
      typeUrl(text, q) {
        const span = url && url.querySelector("span");
        if (!span) return gsap.timeline();
        span.textContent = "";
        return gsap.to(span, { text: { value: text }, duration: (q && q.duration) || Math.min(1.6, text.length * 0.05), ease: "none" });
      },
    };
  }
  // A mouse pointer that moves to elements and clicks:
  // const c = R.cursor({ x: 1500, y: 900 }); tl.add(c.moveTo(".buy"), 2).add(c.click(), 2.8)
  function cursor(options) {
    const o = Object.assign({ x: W * 0.7, y: H * 0.75, color: "#ffffff" }, options || {});
    const host = resolve(o.parent || stage, "R.cursor");
    const c = el("div", { parent: host, className: "r-cursor", style: { left: o.x, top: o.y }, html: '<svg viewBox="0 0 24 24" width="44" height="44"><path d="M4 2 L4 19 L8.6 14.8 L11.6 21.6 L14.6 20.3 L11.6 13.6 L18 13.6 Z" fill="' + escape(o.color) + '" stroke="#0f172a" stroke-width="1.4" stroke-linejoin="round"/></svg>' });
    const rel = relOf(host);
    return {
      element: c,
      moveTo(target, q) {
        const b = Object.assign({ duration: 0.9, ease: "power3.inOut", side: [0.5, 0.55] }, q || {});
        const p = () => point(target, b.side, rel);
        return gsap.to(c, { left: () => p().x, top: () => p().y, duration: b.duration, ease: b.ease });
      },
      click(q) {
        const tl = gsap.timeline();
        const ripple = el("div", { parent: host, className: "r-ripple" });
        if (q && q.color) ripple.style.borderColor = q.color;
        gsap.set(ripple, { opacity: 0 });
        tl.to(c, { scale: 0.82, duration: 0.1, ease: "power2.in", transformOrigin: "10% 5%" })
          .to(c, { scale: 1, duration: 0.18, ease: "back.out(3)" })
          .fromTo(ripple, { left: () => c.offsetLeft + 6, top: () => c.offsetTop + 4, scale: 0.4, opacity: 1 }, { scale: 3.2, opacity: 0, duration: 0.6, ease: "power2.out", immediateRender: false }, 0.05);
        return tl;
      },
    };
  }

  // ------------------------------------------------------------ charts & stats
  // Line or area chart that draws from left to right with a riding value:
  // const c = R.chart({ x: 200, y: 300, w: 1100, h: 500, data: [3, 5, 4, 8, 13], labels: ["Q1", ...], kind: "area" }); tl.add(c.draw(), 1)
  function chart(options) {
    const o = Object.assign({ kind: "line", w: 1000, h: 480, width: 6, smooth: true, grid: 4, decimals: 0 }, options || {});
    const values = (o.data || []).map((d) => typeof d === "number" ? d : d.value);
    const labels = o.labels || (o.data || []).map((d) => typeof d === "number" ? "" : d.label || "");
    const min = o.min === undefined ? Math.min(0, ...values) : o.min, max = o.max === undefined ? Math.max(...values, 1) : o.max;
    const wrap = el("div", { parent: o.parent, className: "r-chart", style: { left: o.x || 0, top: o.y || 0, width: o.w, height: o.h } });
    const svg = svgEl("svg", { width: o.w, height: o.h, viewBox: "0 0 " + o.w + " " + o.h }, wrap);
    const color = o.color || "var(--r-accent)";
    for (let i = 0; i <= o.grid; i++) {
      const y = f1(o.h - (o.h * i) / o.grid);
      svgEl("line", { x1: 0, x2: o.w, y1: y, y2: y, stroke: "rgba(148,163,184,0.16)", "stroke-width": 1.5 }, svg);
    }
    const n = Math.max(1, values.length - 1);
    const pts = values.map((v, i) => [(o.w * i) / n, o.h - ((v - min) / (max - min || 1)) * o.h]);
    const d = pathFromPoints(pts, o.smooth);
    const id = "r-clip-" + Math.floor(Math.random() * 1e9).toString(36);
    const clip = svgEl("clipPath", { id }, svg);
    const clipRect = svgEl("rect", { x: -20, y: -o.h, width: 0, height: o.h * 3 }, clip);
    let area = null;
    if (o.kind === "area") {
      const gid = id + "g";
      const defs = svgEl("defs", {}, svg);
      const grad = svgEl("linearGradient", { id: gid, x1: 0, y1: 0, x2: 0, y2: 1 }, defs);
      svgEl("stop", { offset: "0%", "stop-color": color, "stop-opacity": 0.45 }, grad);
      svgEl("stop", { offset: "100%", "stop-color": color, "stop-opacity": 0 }, grad);
      area = svgEl("path", { d: d + " L" + o.w + " " + o.h + " L0 " + o.h + " Z", fill: "url(#" + gid + ")", "clip-path": "url(#" + id + ")" }, svg);
    }
    const path = svgEl("path", { d, fill: "none", stroke: color, "stroke-width": o.width, "stroke-linecap": "round", "stroke-linejoin": "round", "clip-path": "url(#" + id + ")" }, svg);
    path.style.filter = "drop-shadow(0 0 10px " + color + ")";
    const tip = svgEl("circle", { r: o.width * 1.8, fill: color, stroke: "var(--r-bg)", "stroke-width": 3 }, svg);
    labels.forEach((l, i) => { if (l) el("div", { parent: wrap, className: "r-chart-label", text: l, style: { left: pts[i][0], top: o.h + 18 } }); });
    const value = o.showValue === false ? null : el("div", { parent: wrap, className: "r-chart-value" });
    const length = path.getTotalLength();
    const set = (p) => {
      clipRect.setAttribute("width", String(f1(o.w * p + 20)));
      // The tip follows the curve at the drawn x.
      const x = o.w * p;
      let lo = 0, hi = length;
      for (let k = 0; k < 24; k++) { const mid = (lo + hi) / 2; if (path.getPointAtLength(mid).x < x) lo = mid; else hi = mid; }
      const at = path.getPointAtLength(lo);
      tip.setAttribute("cx", f1(at.x)); tip.setAttribute("cy", f1(at.y));
      tip.style.opacity = p > 0.001 ? "1" : "0";
      if (value) {
        const v = min + ((o.h - at.y) / o.h) * (max - min);
        value.textContent = (o.prefix || "") + v.toFixed(o.decimals) + (o.suffix || "");
        css(value, { left: f1(at.x), top: f1(at.y), opacity: p > 0.001 ? 1 : 0 });
      }
    };
    set(0);
    return {
      element: wrap, path, area,
      draw(q) {
        const proxy = { p: 0 };
        return gsap.to(proxy, { p: 1, duration: (q && q.duration) || 2, ease: (q && q.ease) || "power2.inOut", onUpdate: () => set(proxy.p) });
      },
    };
  }
  // A big number card: const s = R.stat({ x: 1500, y: 300, value: 48, suffix: " ms", label: "p99 latency" }); tl.add(s.show(), 2)
  function stat(options) {
    const o = Object.assign({ value: 0, decimals: 0 }, options || {});
    const card = el("div", { parent: o.parent, className: "r-stat" + (o.className ? " " + o.className : "") });
    if (o.color) card.style.setProperty("--r-accent", o.color);
    const v = el("div", { parent: card, className: "r-stat-value", text: format(o.value, o) });
    const label = el("div", { parent: card, className: "r-stat-label", text: o.label || "" });
    // size: the number's height in px (default 76); the card scales with it.
    if (o.size) {
      v.style.fontSize = o.size + "px";
      label.style.fontSize = Math.max(24, Math.round(o.size * 0.3)) + "px";
      card.style.padding = Math.round(o.size * 0.36) + "px " + Math.round(o.size * 0.44) + "px";
    }
    const w = card.offsetWidth, h = card.offsetHeight;
    css(card, { left: (o.x || 0) - (o.anchor === "top-left" ? 0 : w / 2), top: (o.y || 0) - (o.anchor === "top-left" ? 0 : h / 2) });
    return {
      element: card, value: v,
      show(q) {
        const d = (q && q.duration) || 1.2;
        return gsap.timeline().fromTo(card, { opacity: 0, y: 40, scale: 0.9 }, { opacity: 1, y: 0, scale: 1, duration: 0.6, ease: "back.out(1.6)" }, 0)
          .add(count(v, o.value, Object.assign({}, o, { from: o.from || 0, duration: d })), 0.1);
      },
    };
  }

  // ------------------------------------------------------------ isometric stack
  // Layers of a system as isometric slabs (bottom first):
  // const s = R.iso({ x: 700, y: 640, layers: [{ label: "Storage", icon: "hard-drive" }, { label: "API" }] }); tl.add(s.build(), 1)
  function iso(options) {
    const o = Object.assign({ x: W / 2, y: H * 0.62, size: 440, depth: 26, gap: 92, labels: true }, options || {});
    const host = resolve(o.parent || stage, "R.iso");
    const layersIn = o.layers || [];
    const svg = svgEl("svg", { class: "r-iso", width: W, height: H, viewBox: "0 0 " + W + " " + H }, null);
    host.appendChild(svg);
    const hw = o.size / 2, hh = o.size / 4, t = o.depth;
    const shade = (c, k) => "color-mix(in srgb," + c + " " + Math.round(k * 100) + "%,#000)";
    const slabs = layersIn.map((layer, i) => {
      const c = layer.color || "var(--r-accent-" + ((i % 6) + 1) + ")";
      const cx = o.x, cy = o.y - i * o.gap;
      const g = svgEl("g", { class: "r-iso-slab" }, svg);
      const poly = (pts, fill, extra) => svgEl("polygon", Object.assign({ points: pts.map((p) => f1(p[0]) + "," + f1(p[1])).join(" "), fill }, extra || {}), g);
      poly([[cx - hw, cy], [cx, cy + hh], [cx, cy + hh + t], [cx - hw, cy + t]], shade(c, 0.55));
      poly([[cx, cy + hh], [cx + hw, cy], [cx + hw, cy + t], [cx, cy + hh + t]], shade(c, 0.38));
      const top = poly([[cx, cy - hh], [cx + hw, cy], [cx, cy + hh], [cx - hw, cy]], "color-mix(in srgb," + c + " 30%,var(--r-surface))", { stroke: c, "stroke-width": 2.5 });
      if (layer.icon) {
        const k = o.size / 440;
        const ic = svgEl("g", { transform: "translate(" + f1(cx) + " " + f1(cy) + ") scale(1 0.5) rotate(45) translate(" + f1(-36 * k) + " " + f1(-36 * k) + ") scale(" + f1(3 * k) + ")" }, g);
        ic.innerHTML = (icons[layer.icon] || []).map(iconNode).join("");
        ic.setAttribute("fill", "none"); ic.setAttribute("stroke", c); ic.setAttribute("stroke-width", "1.6"); ic.setAttribute("stroke-linecap", "round"); ic.setAttribute("stroke-linejoin", "round");
      }
      let label = null;
      if (o.labels && layer.label) {
        label = el("div", { parent: host, className: "r-iso-label", html: '<span class="r-iso-dot"></span><span>' + escape(layer.label) + "</span>" + (layer.sub ? "<small>" + escape(layer.sub) + "</small>" : "") });
        css(label, { left: cx + hw + 50, top: cy - 20 });
        const lead = svgEl("line", { x1: f1(cx + hw), y1: f1(cy), x2: f1(cx + hw + 40), y2: f1(cy), stroke: c, "stroke-width": 2.5 }, g);
        lead.setAttribute("stroke-dasharray", "4 6");
      }
      return { g, top, label, color: c };
    });
    return {
      element: svg, slabs: slabs.map((s) => s.g), labels: slabs.map((s) => s.label),
      build(q) {
        const s = (q && q.stagger) || 0.28;
        const tl = gsap.timeline();
        slabs.forEach((slab, i) => {
          tl.fromTo(slab.g, { y: -160, opacity: 0 }, { y: 0, opacity: 1, duration: 0.7, ease: "back.out(1.4)" }, i * s);
          if (slab.label) tl.fromTo(slab.label, { opacity: 0, x: -20 }, { opacity: 1, x: 0, duration: 0.5, ease: "power3.out" }, i * s + 0.3);
        });
        return tl;
      },
      // Separates the slabs vertically to show them apart.
      explode(q) {
        const extra = (q && q.spread) || 50;
        const tl = gsap.timeline();
        slabs.forEach((slab, i) => {
          tl.to(slab.g, { y: -i * extra, duration: (q && q.duration) || 0.9, ease: "power3.inOut" }, 0);
          if (slab.label) tl.to(slab.label, { y: -i * extra, duration: (q && q.duration) || 0.9, ease: "power3.inOut" }, 0);
        });
        return tl;
      },
      highlight(i, q) {
        const slab = slabs[i];
        return gsap.timeline().to(slab.top, { attr: { "stroke-width": 6 }, duration: 0.3 }).to(slab.g, { y: "-=24", duration: 0.4, ease: "power2.out" }, 0);
      },
    };
  }

  // ------------------------------------------------------------ kinetic type
  // Headline entrances on SplitText: tl.add(R.headline(".title", { by: "chars", style: "rise" }), 0.3)
  // Styles: rise (masked slide up), pop, blur, scramble, slide.
  function headline(target, options) {
    const o = Object.assign({ by: "words", style: "rise", stagger: null, duration: 0.8 }, options || {});
    const node = resolve(target, "R.headline");
    if (o.style === "scramble") return gsap.from(node, { duration: o.duration * 1.6, scrambleText: { text: "", chars: o.chars || "upperCase", speed: 0.6 } });
    const split = new SplitText(node, { type: o.by === "chars" ? "words,chars" : o.by === "lines" ? "lines" : "words", mask: o.style === "rise" ? (o.by === "chars" ? "words" : o.by) : undefined });
    const parts = o.by === "chars" ? split.chars : o.by === "lines" ? split.lines : split.words;
    const stagger = o.stagger === null ? (o.by === "chars" ? 0.025 : o.by === "lines" ? 0.12 : 0.07) : o.stagger;
    if (o.style === "pop") return gsap.from(parts, { scale: 0, opacity: 0, duration: o.duration * 0.7, stagger, ease: "back.out(2.2)", transformOrigin: "50% 80%" });
    if (o.style === "blur") return gsap.from(parts, { opacity: 0, filter: "blur(16px)", y: 20, duration: o.duration, stagger, ease: "power3.out" });
    if (o.style === "slide") return gsap.from(parts, { opacity: 0, x: 60, duration: o.duration, stagger, ease: "power3.out" });
    return gsap.from(parts, { yPercent: 110, duration: o.duration, stagger, ease: "power4.out" });
  }
  // Words that replace each other in place: tl.add(R.swap(".word", ["faster", "cheaper", "safer"], { every: 1.2 }), 1)
  function swap(target, words, options) {
    const o = Object.assign({ every: 1.2, duration: 0.5 }, options || {});
    const host = resolve(target, "R.swap");
    host.classList.add("r-swap");
    host.textContent = "";
    const spans = words.map((w) => { const s = document.createElement("span"); s.textContent = w; host.appendChild(s); return s; });
    const widest = Math.max(...spans.map((s) => s.offsetWidth));
    css(host, { width: widest, height: spans[0].offsetHeight });
    gsap.set(spans, { yPercent: 105, autoAlpha: 0 });
    gsap.set(spans[0], { yPercent: 0, autoAlpha: 1 });
    const tl = gsap.timeline();
    for (let i = 1; i < spans.length; i++) {
      const at = o.every * i;
      tl.to(spans[i - 1], { yPercent: -105, duration: o.duration, ease: "power3.inOut" }, at)
        .set(spans[i - 1], { autoAlpha: 0 }, at + o.duration)
        .set(spans[i], { autoAlpha: 1 }, at)
        .fromTo(spans[i], { yPercent: 105 }, { yPercent: 0, duration: o.duration, ease: "power3.inOut", immediateRender: false }, at);
    }
    return tl;
  }
  // Lines of text that replace each other in one place (step captions,
  // narration lines), each at its own time, crossfading:
  // tl.add(R.captions(".caption", [[0, "1 · Start one new pod"], [2.5, "2 · Wait until it is Ready"]]), 5)
  function captions(target, lines, options) {
    const o = Object.assign({ duration: 0.35, y: 14 }, options || {});
    const host = resolve(target, "R.captions");
    if (getComputedStyle(host).position === "static") host.style.position = "relative";
    host.textContent = "";
    const items = lines.map((line) => {
      const [at, text] = Array.isArray(line) ? line : [line.at, line.text];
      const node = document.createElement("div");
      node.className = "r-caption-line";
      node.textContent = text;
      host.appendChild(node);
      return { at, node };
    });
    // The host keeps the size of its largest line; lines share one place.
    const height = Math.max(...items.map((i) => i.node.offsetHeight), 1);
    items.forEach((i) => css(i.node, { position: "absolute", left: 0, top: 0, width: "100%" }));
    if (!host.style.height) host.style.height = height + "px";
    gsap.set(items.map((i) => i.node), { autoAlpha: 0 });
    const tl = gsap.timeline();
    items.forEach((item, index) => {
      tl.fromTo(item.node, { autoAlpha: 0, y: o.y }, { autoAlpha: 1, y: 0, duration: o.duration, ease: "power2.out", immediateRender: false }, item.at);
      const next = items[index + 1];
      if (next) tl.to(item.node, { autoAlpha: 0, y: -o.y, duration: o.duration * 0.8, ease: "power2.in" }, Math.max(item.at + o.duration, next.at - o.duration * 0.8));
    });
    return tl;
  }
  // A slow, continuous camera push on a container so the frame never freezes:
  // R.drift(".world", { scale: 1.08 }) (place it on the scene's outer container).
  function drift(target, options) {
    const o = Object.assign({ scale: 1.06, x: 0, y: 0, rotate: 0, duration: config.duration, ease: "sine.inOut" }, options || {});
    const node = resolve(target, "R.drift");
    gsap.set(node, { transformOrigin: o.origin || "50% 50%" });
    return gsap.fromTo(node, { scale: 1, x: 0, y: 0, rotation: 0 }, { scale: o.scale, x: o.x, y: o.y, rotation: o.rotate, duration: Math.max(0.5, o.duration), ease: o.ease });
  }
  // A band of light sweeping once across a card, button, stat or panel:
  // tl.add(R.shine(".card"), 2)
  function shine(target, options) {
    const o = Object.assign({ duration: 0.9, color: "rgba(255,255,255,.4)", angle: 18, width: 0.3, ease: "power2.inOut" }, options || {});
    const node = resolve(target, "R.shine");
    if (getComputedStyle(node).position === "static") node.style.position = "relative";
    const mask = document.createElement("span");
    mask.className = "r-shine";
    const band = document.createElement("i");
    const w = Math.max(40, node.offsetWidth * o.width);
    css(band, { width: w, background: "linear-gradient(90deg, transparent, " + o.color + ", transparent)", transform: "skewX(" + -o.angle + "deg)" });
    mask.appendChild(band);
    node.appendChild(mask);
    return gsap.fromTo(band, { x: -w * 1.6 }, { x: node.offsetWidth + w * 0.6, duration: o.duration, ease: o.ease });
  }
  // A product shot: a window, phone, card or logo plate shown in perspective,
  // as if filmed, with a soft contact shadow below it and a reflection that
  // moves across it while the camera eases round and in. The element keeps
  // its place in the layout; only its transform changes.
  // tl.add(R.present(w.element, { from: { rx: 16, ry: -24 }, to: { rx: 5, ry: -8 }, duration: 6 }), 0)
  function present(target, options) {
    const o = Object.assign({ push: 1.06, duration: Math.max(1, config.duration), ease: "power2.inOut", perspective: 1800, shadow: true, sheen: true }, options || {});
    const from = Object.assign({ rx: 16, ry: -24, rz: 2 }, o.from || {});
    const to = Object.assign({ rx: 5, ry: -8, rz: 0 }, o.to || {});
    const node = resolve(target, "R.present");
    const tl = gsap.timeline();
    gsap.set(node, { transformPerspective: o.perspective, transformOrigin: "50% 50%" });
    // The push is a move toward the lens (z), so the element's own scale
    // stays free for its entrance (a window's open()).
    tl.fromTo(node, { rotationX: from.rx, rotationY: from.ry, rotation: from.rz, z: 0 }, { rotationX: to.rx, rotationY: to.ry, rotation: to.rz, z: o.perspective * (1 - 1 / o.push), duration: o.duration, ease: o.ease }, 0);
    if (o.shadow && node.parentElement) {
      const w = node.offsetWidth, h = node.offsetHeight;
      const shadow = document.createElement("div");
      shadow.className = "r-present-shadow";
      css(shadow, { left: node.offsetLeft + w * 0.1, top: node.offsetTop + h * 0.9, width: w * 0.8, height: Math.max(30, h * 0.16) });
      node.parentElement.insertBefore(shadow, node);
      tl.fromTo(shadow, { scaleX: 0.86, opacity: 0.55 }, { scaleX: 1.02, opacity: 0.8, duration: o.duration, ease: o.ease }, 0);
    }
    if (o.sheen) {
      if (getComputedStyle(node).position === "static") node.style.position = "relative";
      const sheen = document.createElement("span");
      sheen.className = "r-present-sheen";
      node.appendChild(sheen);
      tl.fromTo(sheen, { backgroundPosition: "110% 0%" }, { backgroundPosition: "-10% 0%", duration: o.duration, ease: "none" }, 0);
    }
    return tl;
  }
  // An attention punch: scale up and settle, with an optional glow.
  function pulse(target, options) {
    const o = Object.assign({ scale: 1.12, duration: 0.5 }, options || {});
    const node = resolve(target, "R.pulse");
    const tl = gsap.timeline();
    tl.to(node, { scale: o.scale, duration: o.duration * 0.4, ease: "power2.out" }).to(node, { scale: 1, duration: o.duration * 0.6, ease: "elastic.out(1, 0.5)" });
    if (o.glow) tl.fromTo(node, { boxShadow: "0 0 0px 0px " + o.glow }, { boxShadow: "0 0 60px 12px " + o.glow, duration: o.duration * 0.4, yoyo: true, repeat: 1 }, 0);
    return tl;
  }
`;
