"use client";
import { fontFaceFamily } from "@/lib/text-style";
import { useFontFaces } from "./useFontFaces";
// A short specimen in an uploaded font; says so when the browser rejects it.
export function FontPreview({
  id,
  src,
  name,
}: {
  id: string;
  src: string;
  name: string;
}) {
  const status = useFontFaces({ [id]: src });
  return (
    <p
      className="font-preview"
      aria-label={`${name} preview`}
      style={{
        fontFamily: `"${fontFaceFamily(id)}", Arial, sans-serif`,
        fontSize: 22,
        margin: 0,
      }}
    >
      {status === "failed"
        ? "This font could not be displayed."
        : status === "ready"
          ? "Aa Bb Cc 123"
          : "Loading font…"}
    </p>
  );
}
