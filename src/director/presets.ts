// Style presets the maker can pick for the AI director: each adds a creative
// direction for the storyboard and every scene.
export const directorPresets = {
  "tech-explainer": {
    label: "Tech explainer",
    direction:
      "Dark, precise technical motion graphics: systems drawn as diagram nodes with icons, connectors that draw on with glowing packets travelling along them, code that types itself, numbers that count; neon accents on deep navy; the camera zooms into the part being explained.",
  },
  "product-launch": {
    label: "Product launch (3D)",
    direction:
      "A cinematic product launch: 3D hero shots with R.three on a dark studio set (the maker's product or logo images if provided, otherwise sleek devices, cards and extruded logos), emissive accent edges with bloom, slow camera dollies and orbits, huge confident type with one claim per beat, specs that count up, and an ending on the logo and tagline. Use R.finish for grain and vignette.",
  },
  "kinetic-type": {
    label: "Kinetic typography",
    direction:
      "Typography is the visual: huge words and lines animating in with SplitText (characters and words), mask and scale reveals, words that swap in place, rhythmic changes every beat, bold contrasting colour fields, very little other imagery.",
  },
  "data-story": {
    label: "Data story",
    direction:
      "A data story: numbers that count up, bar and line charts that grow and draw, comparisons and timelines; one clear takeaway per scene, a restrained palette with one highlight colour, annotations that point at the key figure.",
  },
  "clean-light": {
    label: "Clean and light",
    direction:
      "A clean, light, modern SaaS look: light background, soft shadows, rounded white cards, calm easing, friendly icons, crisp product-UI fragments; clarity over spectacle, but frames that are well filled.",
  },
  "social-reel": {
    label: "Social reel",
    direction:
      "Fast, punchy short-form pacing: a hook in the first second, big centred type within the safe area, a change every one to two seconds, bold saturated colours, caption-style text, and a strong final frame.",
  },
} as const;
export type DirectorPreset = keyof typeof directorPresets;
export const directorPresetIds = Object.keys(directorPresets) as [
  DirectorPreset,
  ...DirectorPreset[],
];
