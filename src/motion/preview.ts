// Where the studio serves motion libraries to code-scene previews.
export function previewMotionBaseUrl() {
  return typeof window === "undefined"
    ? ""
    : `${window.location.origin}/motion-lib`;
}
