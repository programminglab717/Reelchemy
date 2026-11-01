"use client";
import { useEffect, useRef, useState } from "react";
import { useAccountFetch } from "./AccountBoundary";
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
  async function submit(body: FormData | File) {
    const controller = new AbortController();
    active.current.add(controller);
    try {
      return await submitMedia(
        accountFetch,
        endpoint,
        body,
        receipt,
        controller.signal,
        (next) => {
          if (!controller.signal.aborted) setMessage(next);
        },
      );
    } finally {
      active.current.delete(controller);
      if (!controller.signal.aborted && active.current.size === 0)
        setMessage("");
    }
  }
  return { submit, message };
}
