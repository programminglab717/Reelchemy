"use client";
import { useEffect, useState } from "react";
import { loadFontFace } from "@/video/font-faces";

export function useFontFaces(
  sources: Record<string, string>,
): "loading" | "ready" | "failed" {
  const key = JSON.stringify(Object.entries(sources).sort());
  const [result, setResult] = useState<{
    key: string;
    status: "ready" | "failed";
  }>();
  useEffect(() => {
    let active = true;
    const entries = JSON.parse(key) as [string, string][];
    Promise.all(entries.map(([id, src]) => loadFontFace(id, src))).then(
      () => active && setResult({ key, status: "ready" }),
      () => active && setResult({ key, status: "failed" }),
    );
    return () => {
      active = false;
    };
  }, [key]);
  return result?.key === key ? result.status : "loading";
}
