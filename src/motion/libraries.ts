// Files a code scene may load, by public name. Only these are served to scene
// documents (by the studio for previews and by each export's private asset
// server); scene code cannot name any other path.
export const motionFiles = {
  "gsap.js": "gsap/dist/gsap.min.js",
  "SplitText.js": "gsap/dist/SplitText.min.js",
  "DrawSVGPlugin.js": "gsap/dist/DrawSVGPlugin.min.js",
  "MorphSVGPlugin.js": "gsap/dist/MorphSVGPlugin.min.js",
  "MotionPathPlugin.js": "gsap/dist/MotionPathPlugin.min.js",
  "ScrambleTextPlugin.js": "gsap/dist/ScrambleTextPlugin.min.js",
  "TextPlugin.js": "gsap/dist/TextPlugin.min.js",
  "CustomEase.js": "gsap/dist/CustomEase.min.js",
  "d3.js": "d3/dist/d3.min.js",
  "fonts/inter.woff2":
    "@fontsource-variable/inter/files/inter-latin-wght-normal.woff2",
  "fonts/space-grotesk.woff2":
    "@fontsource-variable/space-grotesk/files/space-grotesk-latin-wght-normal.woff2",
  "fonts/jetbrains-mono.woff2":
    "@fontsource-variable/jetbrains-mono/files/jetbrains-mono-latin-wght-normal.woff2",
  // Generated from lucide-static's icon data (see motion-files.ts).
  "icons.js": "lucide-static/icon-nodes.json",
  // three.js and chosen add-ons, bundled ahead of time as one plain script
  // (served from src/motion/vendor/three.js; see three-bundle.ts).
  "three.js": "three/package.json",
} as const;
export type MotionFile = keyof typeof motionFiles;
export const gsapPlugins = [
  "SplitText",
  "DrawSVGPlugin",
  "MorphSVGPlugin",
  "MotionPathPlugin",
  "ScrambleTextPlugin",
  "TextPlugin",
  "CustomEase",
] as const;
// Optional libraries a scene declares; GSAP, its plugins, icons and fonts are
// always available.
export const optionalMotionLibraries = ["d3", "three"] as const;
export type OptionalMotionLibrary = (typeof optionalMotionLibraries)[number];
export const motionFonts = {
  Inter: "fonts/inter.woff2",
  "Space Grotesk": "fonts/space-grotesk.woff2",
  "JetBrains Mono": "fonts/jetbrains-mono.woff2",
} as const;
export function isMotionFile(name: string): name is MotionFile {
  return Object.hasOwn(motionFiles, name);
}
export function motionFileType(name: MotionFile) {
  return name.endsWith(".woff2")
    ? "font/woff2"
    : "text/javascript; charset=utf-8";
}
