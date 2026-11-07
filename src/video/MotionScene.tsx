import React, {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { continueRender, delayRender } from "remotion";
import { motionDocument, type MotionCode } from "../motion/document";
import type { Timeline } from "../lib/schema";

type Reply = { reelchemy: "ready" | "rewind"; id: number };
// A stable 32-bit seed per scene, so randomness in scene code is repeatable.
export function motionSeed(sceneId: string) {
  let hash = 2166136261;
  for (const char of sceneId) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}
// Hosts a code scene in a sandboxed, opaque-origin document and holds each
// frame until the scene's virtual clock has reached it and painted.
export function MotionScene({
  code,
  sceneId,
  format,
  width,
  height,
  durationFrames,
  frame,
  baseUrl,
}: {
  code: MotionCode;
  sceneId: string;
  format: Timeline["format"];
  width: number;
  height: number;
  durationFrames: number;
  frame: number;
  baseUrl: string;
}) {
  const fps = 30;
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [generation, setGeneration] = useState(0);
  const document = useMemo(
    () =>
      baseUrl
        ? motionDocument({
            code,
            baseUrl,
            format,
            width,
            height,
            fps,
            durationSeconds: durationFrames / fps,
            seed: motionSeed(sceneId),
          })
        : "",
    [code, baseUrl, format, width, height, durationFrames, sceneId],
  );
  const state = useRef({
    loaded: false,
    waiting: [] as (() => void)[],
    replies: new Map<number, (reply: Reply) => void>(),
    next: 0,
    // Frame holds carried across a reload, released once a frame is ready.
    carried: [] as number[],
  });
  useEffect(() => {
    const current = state.current;
    const onMessage = (event: MessageEvent) => {
      if (event.source !== frameRef.current?.contentWindow) return;
      const data = event.data as {
        reelchemy?: string;
        id?: number;
        message?: string;
      };
      if (data?.reelchemy === "loaded") {
        current.loaded = true;
        for (const resolve of current.waiting.splice(0)) resolve();
      } else if (data?.reelchemy === "error")
        console.error(`Code scene ${sceneId}: ${data.message}`);
      else if (
        (data?.reelchemy === "ready" || data?.reelchemy === "rewind") &&
        typeof data.id === "number"
      ) {
        current.replies.get(data.id)?.(data as Reply);
        current.replies.delete(data.id);
      }
    };
    window.addEventListener("message", onMessage);
    return () => {
      window.removeEventListener("message", onMessage);
      for (const carried of current.carried.splice(0)) continueRender(carried);
    };
  }, [sceneId]);
  useLayoutEffect(() => {
    if (!document) return;
    const current = state.current;
    const handle = delayRender(`Code scene ${sceneId} frame ${frame}`, {
      timeoutInMilliseconds: 60000,
    });
    let active = true,
      released = false;
    const release = () => {
      if (released) return;
      released = true;
      continueRender(handle);
    };
    const loaded = () =>
      current.loaded
        ? Promise.resolve()
        : new Promise<void>((resolve) => current.waiting.push(resolve));
    const seek = (time: number) =>
      new Promise<Reply>((resolve) => {
        const id = ++current.next;
        current.replies.set(id, resolve);
        frameRef.current?.contentWindow?.postMessage(
          { reelchemy: "seek", id, time },
          "*",
        );
      });
    void (async () => {
      await loaded();
      if (!active) return;
      const reply = await seek(frame / fps);
      if (!active) return;
      if (reply.reelchemy === "rewind") {
        // Earlier time: reload the document and advance again. Keep this
        // frame held until the reloaded scene has reached it.
        released = true;
        current.carried.push(handle);
        current.loaded = false;
        setGeneration((value) => value + 1);
        return;
      }
      release();
      for (const carried of current.carried.splice(0)) continueRender(carried);
    })();
    return () => {
      // A newer frame (or unmount) supersedes this one; the next effect
      // takes its own hold in the same commit.
      active = false;
      release();
    };
  }, [document, frame, generation, sceneId]);
  if (!document) return null;
  return (
    <iframe
      key={generation}
      ref={frameRef}
      title={`Code scene ${sceneId}`}
      sandbox="allow-scripts"
      srcDoc={document}
      style={{
        position: "absolute",
        inset: 0,
        width,
        height,
        border: 0,
        background: "transparent",
      }}
    />
  );
}
