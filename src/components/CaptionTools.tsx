"use client";
import { MAX_CAPTIONS } from "@/lib/timeline-limits";
import { useRef, useState } from "react";
import {
  importCaptions,
  MAX_SUBTITLE_BYTES,
  parseSubtitles,
  subtitles,
} from "@/lib/captions";
import { captionStyleSchema, type Caption, type Timeline } from "@/lib/schema";

export function CaptionTools({
  timeline,
  onChange,
}: {
  timeline: Timeline;
  onChange: (t: Timeline) => void;
}) {
  const [error, setError] = useState("");
  const [pending, setPending] = useState<{
    name: string;
    cues: Caption[];
  } | null>(null);
  const importVersion = useRef(0);
  const style = timeline.captionStyle || captionStyleSchema.parse({});
  function update(patch: Partial<typeof style>) {
    onChange({ ...timeline, captionStyle: { ...style, ...patch } });
  }
  function apply(mode: "merge" | "replace") {
    if (!pending) return;
    try {
      onChange(importCaptions(timeline, pending.cues, mode));
      setPending(null);
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }
  function download(format: "srt" | "vtt") {
    const url = URL.createObjectURL(
      new Blob([subtitles(timeline, format)], {
        type: "text/plain;charset=utf-8",
      }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = `captions.${format}`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return (
    <div className="caption-tools">
      <h3>Caption appearance & import</h3>
      <p>
        Appearance applies to burned-in captions and the live preview. SRT/VTT
        downloads contain text and timing only. Text uses an 8% side safe area;
        font size scales with the shorter edge of the video.
      </p>
      <div className="layer-fields">
        <label>
          Caption font
          <select
            aria-label="Caption font"
            value={style.fontFamily}
            onChange={(e) =>
              update({ fontFamily: e.target.value as typeof style.fontFamily })
            }
          >
            <option value="sans">Sans serif</option>
            <option value="serif">Serif</option>
            <option value="mono">Monospace</option>
          </select>
        </label>
        <label>
          Caption font size
          <input
            aria-label="Caption font size"
            type="number"
            min={18}
            max={56}
            value={style.fontSize}
            onChange={(e) => {
              const n = Number(e.target.value);
              if (Number.isInteger(n) && n >= 18 && n <= 56)
                update({ fontSize: n });
            }}
          />
        </label>
        <label>
          <input
            aria-label="Bold captions"
            type="checkbox"
            checked={style.bold}
            onChange={(e) => update({ bold: e.target.checked })}
          />{" "}
          Bold
        </label>
        <label>
          Caption text color
          <input
            aria-label="Caption text color"
            type="color"
            value={style.color}
            onChange={(e) => update({ color: e.target.value })}
          />
        </label>
        <label>
          Caption background
          <input
            aria-label="Caption background"
            type="color"
            value={style.background}
            onChange={(e) => update({ background: e.target.value })}
          />
        </label>
        <label>
          Background opacity
          <input
            aria-label="Caption background opacity"
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={style.backgroundOpacity}
            onChange={(e) =>
              update({ backgroundOpacity: Number(e.target.value) })
            }
          />
        </label>
        <label>
          Caption position
          <select
            aria-label="Caption position"
            value={style.position}
            onChange={(e) =>
              update({ position: e.target.value as typeof style.position })
            }
          >
            <option value="top">Top</option>
            <option value="middle">Middle</option>
            <option value="bottom">Bottom</option>
          </select>
        </label>
        <label>
          Caption alignment
          <select
            aria-label="Caption alignment"
            value={style.align}
            onChange={(e) =>
              update({ align: e.target.value as typeof style.align })
            }
          >
            <option value="left">Left</option>
            <option value="center">Center</option>
            <option value="right">Right</option>
          </select>
        </label>
        <label>
          Edge margin (%)
          <input
            aria-label="Caption edge margin"
            type="number"
            min={3}
            max={12}
            step={1}
            value={style.margin}
            onChange={(e) => {
              const n = Number(e.target.value);
              if (n >= 3 && n <= 12) update({ margin: n });
            }}
          />
        </label>
      </div>
      <div className="layer-fields">
        <label>
          Import SRT / WebVTT
          <input
            aria-label="Import subtitles"
            type="file"
            accept=".srt,.vtt,text/vtt"
            onChange={async (e) => {
              const file = e.currentTarget.files?.[0];
              e.currentTarget.value = "";
              const version = ++importVersion.current;
              setPending(null);
              setError("");
              if (!file) return;
              try {
                if (file.size > MAX_SUBTITLE_BYTES)
                  throw new Error("Subtitle files must be 64 KB or smaller.");
                const extension = file.name.split(".").at(-1)?.toLowerCase();
                if (extension !== "srt" && extension !== "vtt")
                  throw new Error("Select an .srt or .vtt subtitle file.");
                const text = new TextDecoder("utf-8", { fatal: true }).decode(
                  await file.arrayBuffer(),
                );
                const cues = parseSubtitles(text, extension);
                importCaptions(timeline, cues, "replace");
                if (importVersion.current === version)
                  setPending({ name: file.name, cues });
              } catch (e) {
                if (importVersion.current === version)
                  setError((e as Error).message);
              }
            }}
          />
        </label>
        <button
          className="subtle"
          disabled={!timeline.captions?.length}
          onClick={() => download("srt")}
        >
          Download current SRT
        </button>
        <button
          className="subtle"
          disabled={!timeline.captions?.length}
          onClick={() => download("vtt")}
        >
          Download current VTT
        </button>
      </div>
      <p>
        UTF-8, up to 64 KB, {MAX_CAPTIONS} non-overlapping cues and 80
        characters per cue. Import rounds timing to 30 fps and flattens line
        breaks. Basic bold/italic/underline/voice tags are removed; embedded
        styling and cue positioning are rejected.
      </p>
      {pending && (
        <div
          className="layer-row"
          role="region"
          aria-label="Subtitle import preview"
        >
          <p>
            {pending.name}: {pending.cues.length} cues ·{" "}
            {(pending.cues[0].startFrame / 30).toFixed(2)}s–
            {(pending.cues.at(-1)!.endFrame / 30).toFixed(2)}s
          </p>
          <p>{pending.cues[0].text}</p>
          <div className="layer-fields">
            <button className="subtle" onClick={() => apply("merge")}>
              Merge imported cues
            </button>
            <button className="subtle" onClick={() => apply("replace")}>
              Replace all captions ({timeline.captions?.length || 0})
            </button>
            <button className="subtle" onClick={() => setPending(null)}>
              Cancel subtitle import
            </button>
          </div>
        </div>
      )}
      {error && (
        <p role="alert" aria-label="Subtitle import error">
          {error}
        </p>
      )}
    </div>
  );
}
