"use client";
import { MAX_SOURCE_SECONDS } from "@/lib/timeline-limits";
import { useMediaSubmission } from "./useMediaSubmission";
import { useEffect, useRef, useState } from "react";
import { encodeRecording } from "@/lib/recording";
import type { AssetUpdate } from "@/lib/project-assets";

type Capture = {
  context: AudioContext;
  node: AudioWorkletNode;
  stream: MediaStream;
  chunks: Float32Array[];
  frames: number;
  peak: number;
  timer?: ReturnType<typeof setTimeout>;
};
export function NarrationRecorder({
  projectId,
  notes = [],
  onProject,
  onPendingChange,
  onActiveChange,
  onStart,
}: {
  projectId: string;
  notes?: {
    id: string;
    title: string;
    text: string;
    durationFrames: number;
    startFrame: number;
  }[];
  onProject: (p: AssetUpdate) => void;
  onPendingChange: (pending: boolean) => void;
  onActiveChange?: (active: boolean) => void;
  onStart: () => void;
}) {
  const [noteId, setNoteId] = useState("");
  const currentNote = notes.find((note) => note.id === noteId) || notes[0];
  const upload = useMediaSubmission(`/api/projects/${projectId}/assets`);
  const [state, setState] = useState<
    "idle" | "permission" | "recording" | "stopping" | "review" | "saving"
  >("idle");
  const [draft, setDraft] = useState<{
    blob: Blob;
    url: string;
    seconds: number;
    peak: number;
  } | null>(null);
  const [seconds, setSeconds] = useState(0),
    [level, setLevel] = useState(0),
    [error, setError] = useState("");
  const [name, setName] = useState("Narration"),
    [rights, setRights] = useState(
      "I recorded this narration and have permission to use it",
    );
  const capture = useRef<Capture | null>(null),
    version = useRef(0),
    draftUrl = useRef<string | null>(null);
  useEffect(() => {
    onActiveChange?.(
      ["permission", "recording", "stopping", "saving"].includes(state),
    );
  }, [state, onActiveChange]);
  useEffect(() => () => onActiveChange?.(false), [onActiveChange]);
  function release() {
    const c = capture.current;
    capture.current = null;
    if (c) {
      clearTimeout(c.timer);
      c.node.disconnect();
      c.stream.getTracks().forEach((t) => t.stop());
      void c.context.close();
    }
  }
  function clearDraft() {
    if (draftUrl.current) URL.revokeObjectURL(draftUrl.current);
    draftUrl.current = null;
    setDraft(null);
  }
  useEffect(
    () => () => {
      version.current++;
      const c = capture.current;
      if (c) {
        clearTimeout(c.timer);
        c.node.disconnect();
        c.stream.getTracks().forEach((t) => t.stop());
        void c.context.close();
      }
      if (draftUrl.current) URL.revokeObjectURL(draftUrl.current);
      onPendingChange(false);
    },
    [onPendingChange],
  );
  useEffect(() => {
    if (state === "idle") return;
    function warn(e: BeforeUnloadEvent) {
      e.preventDefault();
      e.returnValue = "";
    }
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [state]);
  async function start() {
    setError("");
    if (
      !window.isSecureContext ||
      !navigator.mediaDevices?.getUserMedia ||
      !window.AudioWorkletNode
    ) {
      setError(
        "Microphone recording needs HTTPS (or localhost) and a browser with AudioWorklet support. You can also upload a recorded audio file.",
      );
      return;
    }
    const attempt = ++version.current;
    setState("permission");
    onPendingChange(true);
    onStart();
    let stream: MediaStream | undefined, context: AudioContext | undefined;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
        },
        video: false,
      });
      if (attempt !== version.current) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      context = new AudioContext({ sampleRate: 48000 });
      await context.resume();
      await context.audioWorklet.addModule("/narration-worklet.js");
      if (attempt !== version.current) {
        stream.getTracks().forEach((t) => t.stop());
        await context.close();
        return;
      }
      const node = new AudioWorkletNode(context, "narration-capture", {
        processorOptions: {
          maxFrames: Math.min(
            context.sampleRate * MAX_SOURCE_SECONDS,
            Math.floor((10 * 1024 * 1024 - 44) / 2),
          ),
        },
      });
      const c: Capture = {
        context,
        node,
        stream,
        chunks: [],
        frames: 0,
        peak: 0,
      };
      capture.current = c;
      c.timer = setTimeout(() => {
        if (capture.current === c) {
          setState("stopping");
          node.port.postMessage("stop");
        }
      }, 60000);
      node.port.onmessage = (event) => {
        if (capture.current !== c || attempt !== version.current) return;
        if (event.data.type === "samples") {
          const chunk = event.data.chunk as Float32Array;
          c.chunks.push(chunk);
          c.frames += chunk.length;
          let peak = 0;
          for (const sample of chunk) peak = Math.max(peak, Math.abs(sample));
          c.peak = Math.max(c.peak, peak);
          setLevel(peak);
          setSeconds(c.frames / c.context.sampleRate);
        } else if (event.data.type === "done") {
          try {
            const blob = new Blob(
              [encodeRecording(c.chunks, c.context.sampleRate)],
              { type: "audio/wav" },
            );
            const url = URL.createObjectURL(blob);
            draftUrl.current = url;
            setDraft({
              blob,
              url,
              seconds: c.frames / c.context.sampleRate,
              peak: c.peak,
            });
            setState("review");
          } catch (e) {
            setError((e as Error).message);
            setState("idle");
            onPendingChange(false);
          }
          release();
        }
      };
      const source = context.createMediaStreamSource(stream),
        silent = context.createGain();
      silent.gain.value = 0;
      source.connect(node);
      node.connect(silent);
      silent.connect(context.destination);
      setSeconds(0);
      setLevel(0);
      setState("recording");
      stream.getAudioTracks()[0].onended = () => {
        if (capture.current === c) node.port.postMessage("stop");
      };
    } catch (e) {
      stream?.getTracks().forEach((t) => t.stop());
      if (context && context.state !== "closed") void context.close();
      if (attempt === version.current) {
        release();
        setState("idle");
        onPendingChange(false);
        setError(
          e instanceof DOMException && e.name === "NotAllowedError"
            ? "Microphone permission was denied. Allow microphone access in your browser or upload an audio file."
            : `Could not start recording: ${(e as Error).message}`,
        );
      }
    }
  }
  return (
    <section className="narration-recorder" aria-label="Record narration">
      <h3>Record narration</h3>
      <p>
        Record up to 5 minutes with your microphone. Preview the take before
        saving it to project assets, then add it to the timeline. Playback
        pauses when recording begins; use headphones to avoid feedback.
      </p>
      {currentNote && (
        <details className="recording-notes">
          <summary>Scene notes to read while recording</summary>
          <label>
            Notes for scene
            <select
              aria-label="Recording scene notes"
              value={currentNote.id}
              onChange={(e) => setNoteId(e.target.value)}
            >
              {notes.map((note, index) => (
                <option key={note.id} value={note.id}>
                  {index + 1} · {note.title} ·{" "}
                  {(note.durationFrames / 30).toFixed(1)}s
                </option>
              ))}
            </select>
          </label>
          <p aria-label="Recording notes text">
            {currentNote.text ||
              "Write your narration or shot directions in Scene notes."}
          </p>
          <p>
            Scene start: {(currentNote.startFrame / 30).toFixed(2)}s · timeline
            frame {currentNote.startFrame}.
          </p>
          <div className="layer-fields">
            <button
              className="subtle"
              disabled={notes.indexOf(currentNote) === 0}
              onClick={() =>
                setNoteId(notes[notes.indexOf(currentNote) - 1].id)
              }
            >
              Previous scene notes
            </button>
            <button
              className="subtle"
              disabled={notes.indexOf(currentNote) === notes.length - 1}
              onClick={() =>
                setNoteId(notes[notes.indexOf(currentNote) + 1].id)
              }
            >
              Next scene notes
            </button>
          </div>
          <small>
            Longer films can use several takes. Save each take, add it to Sound
            & captions, and place it at the matching timeline frame.
          </small>
        </details>
      )}
      {state === "idle" && (
        <button className="subtle" onClick={() => void start()}>
          Start microphone recording
        </button>
      )}
      {state === "permission" && (
        <>
          <p role="status">Waiting for microphone permission…</p>
          <button
            className="subtle"
            onClick={() => {
              version.current++;
              setState("idle");
              onPendingChange(false);
            }}
          >
            Cancel microphone request
          </button>
        </>
      )}
      {(state === "recording" || state === "stopping") && (
        <div className="layer-fields">
          <output aria-label="Recorded duration">
            {seconds.toFixed(1)}s / 60s
          </output>
          <label>
            Input level{" "}
            <meter
              aria-label="Microphone level"
              min={0}
              max={1}
              high={0.9}
              value={level}
            />
          </label>
          {level >= 0.98 && (
            <span role="status">
              Input is clipping. Move away from the microphone.
            </span>
          )}
          <button
            className="subtle"
            disabled={state === "stopping"}
            onClick={() => {
              setState("stopping");
              capture.current?.node.port.postMessage("stop");
            }}
          >
            Stop recording
          </button>
          <button
            className="subtle"
            onClick={() => {
              version.current++;
              release();
              setState("idle");
              onPendingChange(false);
            }}
          >
            Discard recording
          </button>
        </div>
      )}
      {draft && (
        <div className="layer-row">
          <audio
            aria-label="Recorded narration preview"
            controls
            src={draft.url}
          />
          <p>
            {draft.seconds.toFixed(1)} seconds ·{" "}
            {(draft.blob.size / 1024).toFixed(0)} KB
          </p>
          {draft.peak < 0.005 && (
            <p role="status">
              This take is silent or very quiet. Check your microphone before
              saving.
            </p>
          )}
          {draft.peak >= 0.98 && (
            <p role="status">
              This take reached the input limit and may sound distorted.
              Consider recording it again.
            </p>
          )}
          <div className="layer-fields">
            <label>
              Recording name
              <input
                aria-label="Recording name"
                value={name}
                maxLength={80}
                disabled={state === "saving"}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <label>
              Source / usage rights
              <input
                aria-label="Recording usage rights"
                value={rights}
                minLength={3}
                maxLength={500}
                disabled={state === "saving"}
                onChange={(e) => setRights(e.target.value)}
              />
            </label>
            <button
              className="subtle"
              disabled={
                state === "saving" || !name.trim() || rights.trim().length < 3
              }
              onClick={async () => {
                setState("saving");
                setError("");
                try {
                  const body = new FormData();
                  body.set("kind", "audio");
                  body.set("license", rights.trim());
                  body.set(
                    "file",
                    draft.blob,
                    `${name.trim().replace(/[^a-zA-Z0-9._ -]/g, "_")}.wav`,
                  );
                  const result = await upload.submit(body);
                  onProject(result);
                  clearDraft();
                  setState("idle");
                  onPendingChange(false);
                } catch (e) {
                  setState("review");
                  setError(
                    `Your take is retained here. ${(e as Error).message} You can retry or download it.`,
                  );
                }
              }}
            >
              {state === "saving"
                ? upload.message || "Saving recording…"
                : "Save recording to assets"}
            </button>
            <a className="subtle" href={draft.url} download="narration.wav">
              Download recording
            </a>
            <button
              className="subtle"
              disabled={state === "saving"}
              onClick={() => {
                clearDraft();
                setState("idle");
                onPendingChange(false);
              }}
            >
              Discard take
            </button>
          </div>
        </div>
      )}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
