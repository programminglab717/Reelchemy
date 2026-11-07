import { CLOCK_SOURCE } from "./clock";
import {
  gsapPlugins,
  motionFonts,
  type OptionalMotionLibrary,
} from "./libraries";

// A code scene: markup, styles and script written against a fixed logical
// stage (1920×1080 landscape, 1080×1920 portrait, 1080×1080 square), scaled
// to the output size.
export type MotionCode = {
  html: string;
  css: string;
  js: string;
  libraries?: OptionalMotionLibrary[];
};
export const motionStages = {
  landscape: { width: 1920, height: 1080 },
  portrait: { width: 1080, height: 1920 },
  square: { width: 1080, height: 1080 },
} as const;
export type MotionDocumentOptions = {
  code: MotionCode;
  // Absolute URL of the directory serving the allowlisted motion files.
  baseUrl: string;
  format: keyof typeof motionStages;
  width: number;
  height: number;
  fps: number;
  durationSeconds: number;
  seed: number;
  transparent?: boolean;
};

// The helper kit available to scene code as `R`.
const KIT_SOURCE = String.raw`(() => {
  const config = window.__REELCHEMY_CONFIG__;
  const icons = window.__reelchemyIcons || {};
  const escape = (value) => String(value).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const node = ([tag, attributes]) =>
    "<" + tag + Object.entries(attributes || {}).map(([k, v]) => " " + k + '="' + escape(v) + '"').join("") + "/>";
  window.R = {
    width: config.stage.width,
    height: config.stage.height,
    fps: config.fps,
    duration: config.duration,
    stage: document.getElementById("stage"),
    random: Math.random,
    range: (min, max) => min + Math.random() * (max - min),
    // Lucide icon as SVG markup, e.g. R.icon("database", { size: 96, color: "#7dd3fc" }).
    icon(name, options = {}) {
      const nodes = icons[name];
      if (!nodes) throw new Error("Unknown icon: " + name);
      const size = options.size || 48;
      return '<svg xmlns="http://www.w3.org/2000/svg" width="' + size + '" height="' + size +
        '" viewBox="0 0 24 24" fill="none" stroke="' + escape(options.color || "currentColor") +
        '" stroke-width="' + (options.strokeWidth || 2) + '" stroke-linecap="round" stroke-linejoin="round"' +
        (options.className ? ' class="' + escape(options.className) + '"' : "") + ">" + nodes.map(node).join("") + "</svg>";
    },
    iconNames: () => Object.keys(icons),
  };
  if (window.gsap) {
    gsap.registerPlugin(...${JSON.stringify(gsapPlugins)}.map((name) => window[name]).filter(Boolean));
    gsap.ticker.lagSmoothing(0);
    window.__reelchemyFlush = () => gsap.ticker.tick();
  }
})();`;

const scriptSafe = (source: string) =>
  source.replace(/<\/(script)/gi, "<\\/$1");
const styleSafe = (source: string) => source.replace(/<\/(style)/gi, "<\\/$1");

export function motionDocument(options: MotionDocumentOptions) {
  const base = options.baseUrl.replace(/\/+$/, "");
  const origin = new URL(base).origin;
  const stage = motionStages[options.format];
  const scale = options.width / stage.width;
  const config = {
    fps: options.fps,
    seed: options.seed >>> 0,
    duration: options.durationSeconds,
    stage,
  };
  const scripts = [
    "gsap.js",
    ...gsapPlugins.map((plugin) => `${plugin}.js`),
    "icons.js",
    ...(options.code.libraries || []).map((library) => `${library}.js`),
  ];
  const fonts = Object.entries(motionFonts)
    .map(
      ([family, file]) =>
        `@font-face{font-family:"${family}";src:url("${base}/${file}") format("woff2");font-weight:100 900;font-display:block}`,
    )
    .join("");
  // No network: scripts, styles and fonts only from the motion file server,
  // images only inline. The document runs in an opaque-origin sandbox.
  const policy = [
    "default-src 'none'",
    `script-src 'unsafe-inline' ${origin}`,
    `style-src 'unsafe-inline' ${origin}`,
    `font-src ${origin} data:`,
    "img-src data: blob:",
    "media-src 'none'",
    "connect-src 'none'",
    "frame-src 'none'",
    "worker-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join("; ");
  return `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${policy}">
<style>${fonts}
html,body{margin:0;padding:0;width:100%;height:100%;overflow:hidden;background:${options.transparent ? "transparent" : "#000"}}
#stage{position:absolute;left:0;top:0;width:${stage.width}px;height:${stage.height}px;transform:scale(${scale});transform-origin:0 0;overflow:hidden;font-family:"Inter",system-ui,sans-serif;-webkit-font-smoothing:antialiased}
*{box-sizing:border-box}</style>
<style>${styleSafe(options.code.css)}</style>
<script>window.__REELCHEMY_CONFIG__=${JSON.stringify(config)};</script>
<script>${scriptSafe(CLOCK_SOURCE)}</script>
${scripts.map((file) => `<script src="${base}/${file}"></script>`).join("\n")}
</head><body><div id="stage">${options.code.html}</div>
<script>${scriptSafe(KIT_SOURCE)}</script>
<script>try{(function(R,gsap){${scriptSafe(options.code.js)}
})(window.R,window.gsap);}catch(error){parent.postMessage({reelchemy:"error",message:String(error&&error.stack||error).slice(0,2000)},"*");}</script>
<script>window.addEventListener("load",()=>parent.postMessage({reelchemy:"loaded"},"*"));</script>
</body></html>`;
}
