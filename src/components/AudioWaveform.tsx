"use client";
import { useAccountFetch } from "./AccountBoundary";
import { useEffect, useState } from "react";
import { waveformBars, type Waveform } from "@/lib/waveform-math";
import type { TrackRange } from "@/lib/track-edit";
import { clientWait } from "@/lib/client-wait";
export function AudioWaveform({
  src,
  range,
  volume,
}: {
  src: string;
  range: TrackRange;
  volume: number;
}) {
  const accountFetch = useAccountFetch();
  const [data, setData] = useState<{ src: string; waveform: Waveform } | null>(
    null,
  );
  const [error, setError] = useState<{ src: string; message: string } | null>(
    null,
  );
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      const deadline = Date.now() + 120000;
      while (!controller.signal.aborted && Date.now() < deadline) {
        const r = await accountFetch(src, { signal: controller.signal });
        const result = await r.json();
        const retryAfter = Number(r.headers.get("Retry-After"));
        if (
          r.status === 202 ||
          ([429, 503].includes(r.status) && retryAfter > 0 && retryAfter <= 5)
        ) {
          await clientWait(
            Math.max(1000, Math.min(5000, retryAfter * 1000 || 1000)),
            controller.signal,
          );
          continue;
        }
        if (!r.ok) throw new Error(result.error || "Waveform unavailable");
        if (!controller.signal.aborted) {
          setData({ src, waveform: result });
          setError(null);
        }
        return;
      }
      throw new Error(
        "Waveform preparation is still pending. Try again shortly.",
      );
    })().catch((e) => {
      if (!controller.signal.aborted) setError({ src, message: e.message });
    });
    return () => controller.abort();
  }, [src, retry, accountFetch]);
  if (error?.src === src)
    return (
      <button
        type="button"
        className="waveform-retry"
        aria-label="Retry waveform"
        title={error.message}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={() => setRetry((n) => n + 1)}
      >
        Retry waveform
      </button>
    );
  if (data?.src !== src)
    return <span className="waveform-message">Loading waveform…</span>;
  const bars = waveformBars(
    data.waveform,
    range.offsetFrames,
    range.durationFrames,
    volume,
  );
  return (
    <svg
      className="audio-waveform"
      viewBox={`0 0 ${bars.length} 24`}
      preserveAspectRatio="none"
      role="img"
      aria-label="Source audio waveform"
    >
      <title>
        Source amplitude with clip volume. This does not represent the final
        mix.
      </title>
      {bars.map((peak, i) => (
        <rect
          key={i}
          x={i}
          y={12 - Math.max(0.5, peak * 12)}
          width={0.75}
          height={Math.max(1, peak * 24)}
        />
      ))}
    </svg>
  );
}
