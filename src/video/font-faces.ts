import { fontFaceFamily } from "../lib/text-style";

// Registers an uploaded font with the document once per asset and source.
const loaded = new Map<string, Promise<void>>();
export function loadFontFace(id: string, src: string): Promise<void> {
  const key = `${id} ${src}`;
  let pending = loaded.get(key);
  if (!pending) {
    const face = new FontFace(
      fontFaceFamily(id),
      `url(${JSON.stringify(src)})`,
    );
    pending = face.load().then((ready) => {
      document.fonts.add(ready);
    });
    pending.catch(() => loaded.delete(key));
    loaded.set(key, pending);
  }
  return pending;
}
