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
    const camera = el.closest("[data-r-camera]");
    if (!camera) return false;
    const t = getComputedStyle(camera).transform;
    return !!t && t !== "none" && t !== "matrix(1, 0, 0, 1, 0, 0)";
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
  // Overlapping text boxes (not nested).
  for (let i = 0; i < texts.length; i++)
    for (let j = i + 1; j < texts.length; j++) {
      const a = texts[i], b = texts[j];
      if (a.contains(b) || b.contains(a)) continue;
      const p = local(a), q = local(b);
      const ix = Math.max(0, Math.min(p.x + p.w, q.x + q.w) - Math.max(p.x, q.x));
      const iy = Math.max(0, Math.min(p.y + p.h, q.y + q.h) - Math.max(p.y, q.y));
      if (ix * iy > 0.25 * Math.min(p.w * p.h, q.w * q.h))
        notes.push("Text " + label(a) + " overlaps text " + label(b) + ".");
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
export const CONTENT_BOUNDS_SOURCE = String.raw`(() => {
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
  const decorative = (el) => !!el.closest(".r-grid,.r-glow,.r-particles");
  const framed = (el) => {
    const camera = el.closest("[data-r-camera]");
    if (!camera) return false;
    const t = getComputedStyle(camera).transform;
    return !!t && t !== "none" && t !== "matrix(1, 0, 0, 1, 0, 0)";
  };
  const candidates = [...stage.querySelectorAll("*")].filter((el) => {
    if (el.closest(".r-layer") && !el.closest(".r-stroke")) return false;
    if (el.closest(".r-layer")) return el.matches(".r-stroke > path, .r-packet");
    const tag = el.tagName.toLowerCase();
    if (el.closest("svg") && tag !== "svg") return false;
    if (tag === "svg" || tag === "img" || tag === "canvas") return true;
    return [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
  });
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const el of candidates) {
    if (decorative(el) || framed(el) || !visible(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) continue;
    const x = (r.left - box.left) / scale, y = (r.top - box.top) / scale;
    const w = r.width / scale, h = r.height / scale;
    if (w * h > W * H * 0.6) continue;
    if (x + w <= 0 || y + h <= 0 || x >= W || y >= H) continue;
    x0 = Math.min(x0, x); y0 = Math.min(y0, y);
    x1 = Math.max(x1, x + w); y1 = Math.max(y1, y + h);
  }
  return x0 === Infinity ? null : { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
})()`;
