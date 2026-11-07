// The virtual clock injected before any scene code or library.
//
// Scene code is ordinary browser animation code (GSAP timelines,
// requestAnimationFrame loops, timers). Inside the sandboxed scene document,
// time only moves when the host asks for a frame: Date, performance.now,
// requestAnimationFrame, timers and Math.random are replaced, and each request
// advances the clock in fixed frame steps from the current time. Exported
// frames are therefore the exact moment in the animation, independent of
// machine speed, and identical across renders. Moving backwards is reported
// to the host, which reloads the document and advances again from zero.
//
// Protocol (window messages from the parent only):
//   host  → scene  {reelchemy: "seek", id, time}         time in seconds
//   scene → host   {reelchemy: "ready", id, time}         frame is painted
//   scene → host   {reelchemy: "rewind", id}               reload needed
//   scene → host   {reelchemy: "error", message}           uncaught error
//   scene → host   {reelchemy: "loaded"}                   scripts finished
export const CLOCK_SOURCE = String.raw`(() => {
  "use strict";
  const config = window.__REELCHEMY_CONFIG__;
  const frameMs = 1000 / config.fps;
  // Real frame callbacks, kept only to confirm that a frame has been painted.
  const realRAF = window.requestAnimationFrame.bind(window);
  const epoch = 1767225600000; // 2026-01-01T00:00:00Z, fixed for determinism
  let now = 0;
  const RealDate = Date;
  function VirtualDate(...args) {
    if (!new.target) return new RealDate(epoch + now).toString();
    return args.length ? new RealDate(...args) : new RealDate(epoch + now);
  }
  VirtualDate.prototype = RealDate.prototype;
  VirtualDate.now = () => epoch + now;
  VirtualDate.parse = RealDate.parse;
  VirtualDate.UTC = RealDate.UTC;
  window.Date = VirtualDate;
  Object.defineProperty(performance, "now", { value: () => now, configurable: true });

  // Seeded randomness (mulberry32).
  let seed = config.seed >>> 0;
  const random = () => {
    seed = (seed + 0x6d2b79f5) >>> 0;
    let t = seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  Math.random = random;
  if (window.crypto && crypto.getRandomValues) {
    crypto.getRandomValues = (array) => {
      for (let i = 0; i < array.length; i++)
        array[i] = Math.floor(random() * 2 ** (8 * (array.BYTES_PER_ELEMENT || 1)));
      return array;
    };
  }

  // Animation frames and timers run only when the clock advances.
  let nextId = 1;
  let frames = new Map();
  const timers = new Map();
  window.requestAnimationFrame = (callback) => {
    const id = nextId++;
    frames.set(id, callback);
    return id;
  };
  window.cancelAnimationFrame = (id) => frames.delete(id);
  const schedule = (callback, delay, args, repeat) => {
    const id = nextId++;
    const wait = Math.max(0, Number(delay) || 0);
    timers.set(id, { at: now + wait, wait, callback, args, repeat, order: id });
    return id;
  };
  window.setTimeout = (callback, delay, ...args) => schedule(callback, delay, args, false);
  window.setInterval = (callback, delay, ...args) => schedule(callback, Math.max(1, Number(delay) || 0), args, true);
  window.clearTimeout = window.clearInterval = (id) => timers.delete(id);

  const report = (message) =>
    parent.postMessage({ reelchemy: "error", message: String(message).slice(0, 2000) }, "*");
  window.addEventListener("error", (event) =>
    report(event.error && event.error.stack ? event.error.stack : event.message),
  );
  window.addEventListener("unhandledrejection", (event) =>
    report("Unhandled promise rejection: " + (event.reason && event.reason.stack ? event.reason.stack : event.reason)),
  );
  const call = (callback, args) => {
    try {
      if (typeof callback === "function") callback(...args);
    } catch (error) {
      report(error && error.stack ? error.stack : error);
    }
  };
  function fireTimers(until) {
    for (;;) {
      let due;
      for (const [id, timer] of timers)
        if (timer.at <= until && (!due || timer.at < due[1].at || (timer.at === due[1].at && timer.order < due[1].order)))
          due = [id, timer];
      if (!due) return;
      const [id, timer] = due;
      now = Math.max(now, timer.at);
      if (timer.repeat) timer.at += timer.wait;
      else timers.delete(id);
      call(timer.callback, timer.args);
    }
  }
  function tick(to) {
    fireTimers(to);
    now = to;
    const pending = frames;
    frames = new Map();
    for (const callback of pending.values()) call(callback, [now]);
  }
  // Whole frame steps are counted with an integer, so repeated additions of
  // a fractional frame duration never drift into an extra step.
  let steps = 0;
  function advance(target) {
    const wholeFrames = Math.floor(target / frameMs + 1e-6);
    while (steps < wholeFrames) {
      steps++;
      tick(steps * frameMs);
    }
    // A time between frames (preview scrubbing) gets one partial step.
    if (target - now > 0.5) tick(target);
    // CSS and Web Animations follow the virtual clock too.
    if (document.getAnimations)
      for (const animation of document.getAnimations()) {
        try {
          animation.pause();
          animation.currentTime = now;
        } catch {}
      }
  }
  const painted = () =>
    new Promise((resolve) => {
      const done = () => resolve();
      Promise.all([
        document.fonts ? document.fonts.ready : null,
        ...[...document.images].map((image) =>
          image.complete ? null : new Promise((r) => { image.onload = image.onerror = r; }),
        ),
      ]).then(() => realRAF(() => realRAF(done)));
    });
  let queue = Promise.resolve();
  window.addEventListener("message", (event) => {
    if (event.source !== parent || !event.data || event.data.reelchemy !== "seek") return;
    const { id } = event.data;
    const target = Math.max(0, Number(event.data.time) || 0) * 1000;
    queue = queue.then(async () => {
      if (target < now - 0.5) {
        parent.postMessage({ reelchemy: "rewind", id }, "*");
        return;
      }
      advance(target);
      await painted();
      parent.postMessage({ reelchemy: "ready", id, time: now / 1000 }, "*");
    });
  });
  window.__reelchemyClock = { advance, get now() { return now; } };
})();`;
