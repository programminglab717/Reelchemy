"use client";
import { MAX_SOURCE_FRAMES } from "@/lib/timeline-limits";
import { MAX_AUDIO_TRACKS, MAX_CAPTIONS } from "@/lib/timeline-limits";
import { useState } from "react";
import { CaptionTools } from "./CaptionTools";
import {
  timelineSchema,
  totalFrames,
  type Asset,
  type Timeline,
} from "@/lib/schema";
export function MediaEditor({
  timeline,
  assets,
  onChange,
}: {
  timeline: Timeline;
  assets: Asset[];
  onChange: (t: Timeline) => void;
}) {
  const [error, setError] = useState("");
  const [captionQuery, setCaptionQuery] = useState("");
  const [captionPage, setCaptionPage] = useState(0);
  const pageSize = 25;
  const matchingCaptions = (timeline.captions || [])
    .map((caption, index) => ({ caption, index }))
    .filter(({ caption }) =>
      caption.text
        .toLocaleLowerCase()
        .includes(captionQuery.trim().toLocaleLowerCase()),
    );
  const pages = Math.max(1, Math.ceil(matchingCaptions.length / pageSize));
  const currentPage = Math.min(captionPage, pages - 1);
  const frames = totalFrames(timeline);
  function update(t: Timeline) {
    const result = timelineSchema.safeParse(t);
    if (result.success) {
      setError("");
      onChange(result.data);
    } else setError(result.error.issues.map((i) => i.message).join(" "));
  }
  return (
    <section id="studio-tool-captions" tabIndex={-1} className="layer-editor">
      <h2>Sound & captions</h2>
      <p>
        Timing is in frames at 30 fps. Captions are included in the MP4. Keep
        important artwork clear of your chosen caption area.
      </p>
      <div className="layer-fields">
        {assets
          .filter((a) => a.mime === "audio/wav")
          .map((a) => (
            <button
              key={a.id}
              className="subtle"
              disabled={
                (timeline.audioTracks || []).length >= MAX_AUDIO_TRACKS ||
                (a.durationFrames || 0) < 12
              }
              onClick={() =>
                update({
                  ...timeline,
                  audioTracks: [
                    ...(timeline.audioTracks || []),
                    {
                      id: crypto.randomUUID(),
                      assetId: a.id,
                      startFrame: 0,
                      offsetFrames: 0,
                      durationFrames: Math.min(frames, a.durationFrames || 0),
                      volume: 0.8,
                      fadeFrames: 6,
                    },
                  ],
                })
              }
            >
              Add audio: {a.name}
            </button>
          ))}
      </div>
      {(timeline.audioTracks || []).map((track) => (
        <div className="layer-row" key={track.id}>
          <strong>
            {assets.find((a) => a.id === track.assetId)?.name ||
              "Missing audio"}
          </strong>
          <div className="layer-fields">
            {(
              [
                "startFrame",
                "offsetFrames",
                "durationFrames",
                "volume",
                "fadeFrames",
              ] as const
            ).map((field) => (
              <label key={field}>
                {field}
                <input
                  aria-label={`${field} audio`}
                  type="number"
                  step={field === "volume" ? 0.05 : 1}
                  min={0}
                  max={
                    field === "volume"
                      ? 1
                      : field === "offsetFrames"
                        ? MAX_SOURCE_FRAMES - 1
                        : field === "fadeFrames"
                          ? 150
                          : field === "startFrame"
                            ? frames - 1
                            : frames
                  }
                  value={track[field]}
                  onChange={(e) =>
                    update({
                      ...timeline,
                      audioTracks: timeline.audioTracks!.map((t) =>
                        t.id === track.id
                          ? { ...t, [field]: Number(e.target.value) }
                          : t,
                      ),
                    })
                  }
                />
              </label>
            ))}
            <button
              className="subtle"
              onClick={() =>
                update({
                  ...timeline,
                  audioTracks: timeline.audioTracks!.filter(
                    (t) => t.id !== track.id,
                  ),
                })
              }
            >
              Remove audio
            </button>
          </div>
        </div>
      ))}
      <CaptionTools timeline={timeline} onChange={onChange} />
      <div className="layer-fields">
        <h3>Caption cues</h3>
        <button
          className="subtle"
          disabled={
            (timeline.captions || []).length >= MAX_CAPTIONS ||
            Math.max(0, ...(timeline.captions || []).map((c) => c.endFrame)) >=
              frames
          }
          onClick={() => {
            const startFrame = Math.max(
              0,
              ...(timeline.captions || []).map((c) => c.endFrame),
            );
            setCaptionQuery("");
            setCaptionPage(
              Math.floor((timeline.captions || []).length / pageSize),
            );
            update({
              ...timeline,
              captions: [
                ...(timeline.captions || []),
                {
                  id: crypto.randomUUID(),
                  startFrame,
                  endFrame: Math.min(frames, startFrame + 60),
                  text: "Your caption",
                },
              ],
            });
          }}
        >
          Add caption
        </button>
      </div>
      {((timeline.captions || []).length > pageSize || captionQuery !== "") && (
        <nav className="layer-fields" aria-label="Caption navigation">
          <label>
            Find caption
            <input
              aria-label="Find caption"
              type="search"
              value={captionQuery}
              onChange={(e) => {
                setCaptionQuery(e.target.value);
                setCaptionPage(0);
              }}
            />
          </label>
          <label>
            Caption page
            <select
              aria-label="Caption page"
              value={currentPage}
              onChange={(e) => setCaptionPage(Number(e.target.value))}
            >
              {Array.from({ length: pages }, (_, index) => (
                <option key={index} value={index}>
                  {matchingCaptions.length
                    ? `${index * pageSize + 1}–${Math.min((index + 1) * pageSize, matchingCaptions.length)}`
                    : "No matches"}
                </option>
              ))}
            </select>
          </label>
          <button
            className="subtle"
            disabled={currentPage === 0}
            onClick={() => setCaptionPage(currentPage - 1)}
          >
            Previous captions
          </button>
          <button
            className="subtle"
            disabled={currentPage + 1 >= pages}
            onClick={() => setCaptionPage(currentPage + 1)}
          >
            Next captions
          </button>
          <output aria-live="polite">
            {matchingCaptions.length} matching captions
          </output>
        </nav>
      )}
      {matchingCaptions
        .slice(currentPage * pageSize, (currentPage + 1) * pageSize)
        .map(({ caption, index: i }) => (
          <div className="layer-row" key={caption.id}>
            <div className="layer-fields">
              <label>
                Caption {i + 1}
                <input
                  aria-label={`Caption ${i + 1} text`}
                  value={caption.text}
                  maxLength={80}
                  onChange={(e) =>
                    update({
                      ...timeline,
                      captions: timeline.captions!.map((c) =>
                        c.id === caption.id
                          ? { ...c, text: e.target.value }
                          : c,
                      ),
                    })
                  }
                />
              </label>
              {(["startFrame", "endFrame"] as const).map((field) => (
                <label key={field}>
                  {field}
                  <input
                    aria-label={`Caption ${i + 1} ${field}`}
                    type="number"
                    min={0}
                    max={frames}
                    value={caption[field]}
                    onChange={(e) =>
                      update({
                        ...timeline,
                        captions: timeline.captions!.map((c) =>
                          c.id === caption.id
                            ? { ...c, [field]: Number(e.target.value) }
                            : c,
                        ),
                      })
                    }
                  />
                </label>
              ))}
              <button
                className="subtle"
                onClick={() =>
                  update({
                    ...timeline,
                    captions: timeline.captions!.filter(
                      (c) => c.id !== caption.id,
                    ),
                  })
                }
              >
                Remove caption
              </button>
            </div>
          </div>
        ))}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
