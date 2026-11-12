// Layout checks run inside a code scene's document at a given moment. Source
// text (evaluated in the scene frame), so it stays free of build helpers.
// Returns short, actionable notes; the director decides what matters.
export const LAYOUT_AUDIT_SOURCE = String.raw`(() => {
  const stage = document.getElementById("stage");
  if (!stage) return ["The scene has no #stage element."];
  const scale = stage.getBoundingClientRect().width / stage.offsetWidth || 1;
  const box = stage.getBoundingClientRect();
  const W = stage.offsetWidth, H = stage.offsetHeight;
  const notes = [];
  const label = (el) => {
    const text = (el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 40);
    const id = el.id ? "#" + el.id : el.classList.length ? "." + [...el.classList].join(".") : el.tagName.toLowerCase();
    return text ? id + ' ("' + text + '")' : id;
  };
  const visible = (el) => {
    for (let node = el; node && node !== stage; node = node.parentElement) {
      const style = getComputedStyle(node);
      if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) < 0.05) return false;
    }
    const rect = el.getBoundingClientRect();
    return rect.width > 1 && rect.height > 1;
  };
  const local = (el) => {
    const r = el.getBoundingClientRect();
    return { x: (r.left - box.left) / scale, y: (r.top - box.top) / scale, w: r.width / scale, h: r.height / scale };
  };
  // Elements that directly hold visible text.
  const texts = [...stage.querySelectorAll("*")].filter((el) =>
    ![...el.childNodes].every((n) => n.nodeType !== 3 || !n.textContent.trim()) &&
    !el.closest("svg") && visible(el));
  for (const el of texts) {
    const size = parseFloat(getComputedStyle(el).fontSize);
    if (size < 20) notes.push("Text " + label(el) + " is " + Math.round(size) + "px; use at least 24px on the stage so it stays readable in video.");
    if (el.scrollWidth > el.clientWidth + 2 && getComputedStyle(el).overflowX !== "visible")
      notes.push("Text " + label(el) + " overflows its box horizontally and is clipped.");
  }
  // Content inside a camera container (R.focus) that is zoomed or moved is
  // cropped on purpose; edge checks skip it.
  const framed = (el) => {
    for (let camera = el.closest("[data-r-camera]"); camera; camera = camera.parentElement && camera.parentElement.closest("[data-r-camera]")) {
      const t = getComputedStyle(camera).transform;
      if (t && t !== "none" && t !== "matrix(1, 0, 0, 1, 0, 0)") return true;
    }
    return false;
  };
  const margin = 24;
  const reported = [];
  for (const el of stage.querySelectorAll("*")) {
    if (!visible(el) || el.closest("svg") && el.tagName.toLowerCase() !== "svg") continue;
    if (el.id === "r-fit" || framed(el) || reported.some((parent) => parent.contains(el))) continue;
    const r = local(el);
    const outside = r.x < -margin || r.y < -margin || r.x + r.w > W + margin || r.y + r.h > H + margin;
    const big = r.w * r.h > W * H * 0.6;
    if (outside && !big && (el.textContent || "").trim() && reported.push(el))
      notes.push("Element " + label(el) + " extends outside the stage (" + Math.round(r.x) + "," + Math.round(r.y) + " " + Math.round(r.w) + "×" + Math.round(r.h) + ").");
  }
  for (const el of texts) {
    if (framed(el)) continue;
    const r = local(el);
    if (r.x < 48 || r.y < 32 || r.x + r.w > W - 48 || r.y + r.h > H - 32)
      if (!(r.x < -margin || r.y < -margin || r.x + r.w > W + margin || r.y + r.h > H + margin))
        notes.push("Text " + label(el) + " sits inside the edge safe margin (keep text 64px from the edges).");
  }
  // One text lies under an opaque panel holding the other (a modal over
  // cards, a callout card over a diagram): not a text-on-text clash.
  const opaque = (el) => {
    const c = getComputedStyle(el).backgroundColor.match(/[\d.]+/g);
    return !!c && (c.length < 4 || Number(c[3]) > 0.85);
  };
  const tinted = (el) => {
    const c = getComputedStyle(el).backgroundColor.match(/[\d.]+/g);
    return !!c && (c.length < 4 || Number(c[3]) > 0.05);
  };
  const covered = (a, b, p, q) => {
    const x = (Math.max(p.x, q.x) + Math.min(p.x + p.w, q.x + q.w)) / 2;
    const y = (Math.max(p.y, q.y) + Math.min(p.y + p.h, q.y + q.h)) / 2;
    const top = document.elementFromPoint(box.left + x * scale, box.top + y * scale);
    if (!top) return false;
    const upper = a.contains(top) || top.contains(a) ? a : b.contains(top) || top.contains(b) ? b : null;
    if (!upper) return true;
    const lower = upper === a ? b : a;
    for (let node = upper; node && node !== stage && !node.contains(lower); node = node.parentElement)
      if (opaque(node)) return true;
    return false;
  };
  // During a shot change two shots are on screen at once; their texts are
  // not compared with each other.
  const shot = (el) => el.closest(".r-shot");
  // Overlapping text boxes (not nested).
  for (let i = 0; i < texts.length; i++)
    for (let j = i + 1; j < texts.length; j++) {
      const a = texts[i], b = texts[j];
      if (a.contains(b) || b.contains(a)) continue;
      const p = local(a), q = local(b);
      const ix = Math.max(0, Math.min(p.x + p.w, q.x + q.w) - Math.max(p.x, q.x));
      const iy = Math.max(0, Math.min(p.y + p.h, q.y + q.h) - Math.max(p.y, q.y));
      if (shot(a) !== shot(b) && shot(a) && shot(b)) continue;
      if (ix * iy <= 0.25 * Math.min(p.w * p.h, q.w * q.h)) continue;
      // Under a panel the pair is not a text-on-text clash; text the panel
      // cuts through is reported by the next check.
      if (!covered(a, b, p, q))
        notes.push("Text " + label(a) + " overlaps text " + label(b) + ".");
    }
  // Text cut through by a panel that is not its own (a callout card laid
  // over a list): part of it shows on top and part is hidden. Sampled at
  // three points along its middle. Text that is fully hidden, or that lies
  // behind a veil (a dialog's dimmed backdrop), is not a problem.
  for (const el of texts) {
    const r = local(el);
    if (r.w < 40) continue;
    let hidden = 0, own = 0, by = null;
    for (const f of [0.12, 0.5, 0.88]) {
      const x = r.x + r.w * f, y = r.y + r.h / 2;
      if (x < 0 || y < 0 || x > W || y > H) continue;
      const top = document.elementFromPoint(box.left + x * scale, box.top + y * scale);
      if (!top) continue;
      if (top === el || el.contains(top) || top.contains(el)) { own++; continue; }
      if (top.closest("svg") || (shot(top) !== shot(el) && shot(top) && shot(el))) continue;
      // What lies over the text here: an opaque panel hides it, a tinted
      // layer veils it, and an empty container leaves it showing.
      let state = "clear";
      for (let node = top; node && node !== stage && !node.contains(el); node = node.parentElement) {
        if (opaque(node)) { state = "hidden"; by = node; break; }
        if (tinted(node)) state = "veiled";
      }
      if (state === "hidden") hidden++;
      else if (state === "clear") own++;
    }
    if (hidden && own)
      notes.push("Text " + label(el) + " is partly hidden behind " + label(by) + ". Move one of them, or hide the text before the panel arrives.");
  }
  // One note per kind of problem and element type, with a count.
  const groups = new Map();
  for (const note of notes) {
    const key = note.replace(/ \("[^"]*"\)/g, "").replace(/-?\d+(\.\d+)?/g, "#");
    const group = groups.get(key);
    if (group) group.count++;
    else groups.set(key, { note, count: 1 });
  }
  return [...groups.values()]
    .map((g) => (g.count > 1 ? g.note + " (and " + (g.count - 1) + " similar)" : g.note))
    .slice(0, 20);
})()`;

// The box (in stage pixels) holding the scene's visible content at this
// moment: text, icons, images, canvases and drawn strokes that at least touch
// the stage. Decorative ambience (grids, glows, particles) and content inside
// a moved camera are left out. Null when nothing qualifies.
export function contentBoundsSource(options: { coverage?: boolean } = {}) {
  return String.raw`(() => {
  const coverage = ${options.coverage ? "true" : "false"};
  const stage = document.getElementById("stage");
  if (!stage) return null;
  const box = stage.getBoundingClientRect();
  const scale = box.width / stage.offsetWidth || 1;
  const W = stage.offsetWidth, H = stage.offsetHeight;
  const visible = (el) => {
    for (let node = el; node && node !== stage; node = node.parentElement || node.parentNode) {
      if (!(node instanceof Element)) break;
      const style = getComputedStyle(node);
      if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) < 0.05) return false;
    }
    return true;
  };
  // Ambience: kit backgrounds, and heavily blurred shapes (glow orbs).
  const decorative = (el) => {
    if (el.closest(".r-grid,.r-glow,.r-particles,.r-finish")) return true;
    for (let node = el; node && node !== stage && node instanceof Element; node = node.parentElement) {
      const blur = /blur\(([\d.]+)px\)/.exec(getComputedStyle(node).filter || "");
      if (blur && Number(blur[1]) >= 20) return true;
    }
    return false;
  };
  const framed = (el) => {
    for (let camera = el.closest("[data-r-camera]"); camera; camera = camera.parentElement && camera.parentElement.closest("[data-r-camera]")) {
      const t = getComputedStyle(camera).transform;
      if (t && t !== "none" && t !== "matrix(1, 0, 0, 1, 0, 0)") return true;
    }
    return false;
  };
  const candidates = [...stage.querySelectorAll("*")].filter((el) => {
    if (el.closest(".r-layer") && !el.closest(".r-stroke")) return false;
    if (el.closest(".r-layer")) return el.matches(".r-stroke > path, .r-packet");
    const tag = el.tagName.toLowerCase();
    // Coverage measures drawings by their shapes, not their (often
    // full-frame) canvas; bounds keep the whole <svg>.
    if (coverage && el.closest("svg")) return tag !== "svg" && /^(path|rect|circle|ellipse|polygon|polyline|line|text|image|use)$/.test(tag) && !el.closest("defs,clipPath,mask");
    if (el.closest("svg") && tag !== "svg") return false;
    if (tag === "svg" || tag === "img" || tag === "canvas") return true;
    if ([...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) return true;
    // Panels count too: cards, windows and shapes with a visible fill or border.
    const style = getComputedStyle(el);
    const fill = style.backgroundColor.match(/[\d.]+/g);
    const filled = fill && (fill.length < 4 || Number(fill[3]) > 0.05) && style.backgroundColor !== "transparent";
    return !!filled || style.backgroundImage !== "none" || parseFloat(style.borderTopWidth) > 0.5;
  });
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const el of candidates) {
    if (decorative(el) || (!coverage && framed(el)) || !visible(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) continue;
    const x = (r.left - box.left) / scale, y = (r.top - box.top) / scale;
    const w = r.width / scale, h = r.height / scale;
    // Near-full-frame boxes are backgrounds (coverage allows big panels).
    if (w * h > W * H * (coverage ? 0.9 : 0.6)) continue;
    // Hairlines (grid and guide lines) do not fill a frame.
    if (coverage && Math.min(w, h) < 6) continue;
    if (x + w <= 0 || y + h <= 0 || x >= W || y >= H) continue;
    // Coverage counts only what is on screen.
    const cx0 = coverage ? Math.max(0, x) : x, cy0 = coverage ? Math.max(0, y) : y;
    const cx1 = coverage ? Math.min(W, x + w) : x + w, cy1 = coverage ? Math.min(H, y + h) : y + h;
    x0 = Math.min(x0, cx0); y0 = Math.min(y0, cy0);
    x1 = Math.max(x1, cx1); y1 = Math.max(y1, cy1);
  }
  return x0 === Infinity ? null : { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
})()`;
}
export const CONTENT_BOUNDS_SOURCE = contentBoundsSource();
export const COVERAGE_SOURCE = contentBoundsSource({ coverage: true });
