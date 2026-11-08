import { CLOCK_SOURCE } from "./clock";
import { KIT_SOURCE } from "./kit";
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
  // Project image asset IDs the scene uses.
  assets?: string[];
  // Content scale and offset (stage pixels) that keep it inside the frame.
  fit?: { scale: number; x: number; y: number };
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

const scriptSafe = (source: string) =>
  source.replace(/<\/(script)/gi, "<\\/$1");
const styleSafe = (source: string) => source.replace(/<\/(style)/gi, "<\\/$1");

export function motionDocument(options: MotionDocumentOptions) {
  const base = options.baseUrl.replace(/\/+$/, "");
  const origin = new URL(base).origin;
  const stage = motionStages[options.format];
  const fit = options.code.fit;
  const scale = options.width / stage.width;
  const config = {
    fps: options.fps,
    seed: options.seed >>> 0,
    duration: options.durationSeconds,
    stage,
    three: !!options.code.libraries?.includes("three"),
    assets: options.code.assets || [],
  };
  const scripts = [
    "gsap.js",
    ...gsapPlugins.map((plugin) => `${plugin}.js`),
    "icons.js",
    ...(options.code.libraries || [])
      .filter((library) => library !== "three")
      .map((library) => `${library}.js`),
  ];
  // three.js is ES modules: an import map names them, and a module exposes
  // the core and chosen add-ons as the global THREE before scene code runs.
  const three = config.three
    ? `<script type="importmap">${JSON.stringify({
        imports: {
          three: `${base}/three/build/three.module.js`,
          "three/addons/": `${base}/three/examples/jsm/`,
        },
      })}</script>
<script type="module" onerror="parent.postMessage({reelchemy:'error',message:'three.js could not be loaded.'},'*');window.__reelchemyThreeReady&&window.__reelchemyThreeReady()">
import * as core from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { SVGLoader } from "three/addons/loaders/SVGLoader.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
window.THREE = Object.assign({}, core, { RoundedBoxGeometry, SVGLoader, RoomEnvironment, EffectComposer, RenderPass, UnrealBloomPass, OutputPass });
window.__reelchemyThreeReady && window.__reelchemyThreeReady();
</script>`
    : "";
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
${three}
</head><body><div id="stage">${
    fit
      ? `<div id="r-fit" style="position:absolute;left:0;top:0;width:${stage.width}px;height:${stage.height}px;transform-origin:0 0;transform:translate(${fit.x}px,${fit.y}px) scale(${fit.scale})">${options.code.html}</div>`
      : options.code.html
  }</div>
<script>${scriptSafe(KIT_SOURCE)}</script>
<script>window.__reelchemyGate(Promise.all([window.__reelchemyFonts,window.__reelchemyThree,window.__reelchemyAssets]).then(()=>{try{(function(R,gsap){${scriptSafe(options.code.js)}
})(window.R,window.gsap);}catch(error){parent.postMessage({reelchemy:"error",message:String(error&&error.stack||error).slice(0,2000)},"*");}}));</script>
<script>window.addEventListener("load",()=>parent.postMessage({reelchemy:"loaded"},"*"));</script>
</body></html>`;
}
