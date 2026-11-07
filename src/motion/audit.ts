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
  const margin = 24;
  for (const el of stage.querySelectorAll("*")) {
    if (!visible(el) || el.closest("svg") && el.tagName.toLowerCase() !== "svg") continue;
    const r = local(el);
    const outside = r.x < -margin || r.y < -margin || r.x + r.w > W + margin || r.y + r.h > H + margin;
    const big = r.w * r.h > W * H * 0.6;
    if (outside && !big && (el.textContent || "").trim())
      notes.push("Element " + label(el) + " extends outside the stage (" + Math.round(r.x) + "," + Math.round(r.y) + " " + Math.round(r.w) + "×" + Math.round(r.h) + ").");
  }
  for (const el of texts) {
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
