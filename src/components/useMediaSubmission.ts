"use client";
import { useEffect, useRef, useState } from "react";
import { useAccountFetch } from "./AccountBoundary";
import type { Project } from "@/lib/schema";
import type { AssetUpdate } from "@/lib/project-assets";
import {
  submitMedia,
  type MediaSubmission,
} from "@/lib/media-processing-client";

export function useMediaSubmission(endpoint: string) {
  const accountFetch = useAccountFetch();
  const receipt = useRef<MediaSubmission | null>(null);
  const active = useRef(new Set<AbortController>());
  const [message, setMessage] = useState("");
  useEffect(() => {
    const controllers = active.current;
    return () => {
      for (const controller of controllers) controller.abort();
      controllers.clear();
    };
  }, [endpoint]);
  function submit(body: FormData): Promise<AssetUpdate>;
  function submit(body: File): Promise<Project>;
  async function submit(body: FormData | File): Promise<AssetUpdate | Project> {
    const controller = new AbortController();
    active.current.add(controller);
    try {
      const progress = (next: string) => {
        if (!controller.signal.aborted) setMessage(next);
      };
      return body instanceof FormData
        ? await submitMedia(
            accountFetch,
            endpoint,
            body,
            receipt,
            controller.signal,
            progress,
          )
        : await submitMedia(
            accountFetch,
            endpoint,
            body,
            receipt,
            controller.signal,
            progress,
          );
    } finally {
      active.current.delete(controller);
      if (!controller.signal.aborted && active.current.size === 0)
        setMessage("");
    }
  }
  return { submit, message };
}
