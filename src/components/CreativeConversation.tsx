"use client";
import { useEffect, useRef, useState } from "react";
import { useAccountFetch } from "./AccountBoundary";
import type { ConversationPage, EditorProject } from "@/lib/project-view";
export function CreativeConversation({ project }: { project: EditorProject }) {
  const accountFetch = useAccountFetch();
  const active = useRef<AbortController | null>(null);
  const requested = useRef<number | undefined>(undefined);
  const [selected, setSelected] = useState<ConversationPage | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  useEffect(
    () => () => {
      active.current?.abort();
      active.current = null;
    },
    [],
  );
  const skipped = Math.max(0, project.messages.length - 50);
  const start = (project.messageStart ?? 0) + skipped;
  const total = project.messageCount ?? project.messages.length;
  const page: ConversationPage = selected ?? {
    items: project.messages.slice(-50).map((message, index) => ({
      ...message,
      index: message.index ?? start + index,
    })),
    total,
    rangeStart: start,
    rangeEnd: total,
    nextBefore: start > 0 ? start : null,
    newerBefore: null,
    unavailable: project.messageUnavailable ?? 0,
  };
  async function load(before?: number) {
    if (active.current) return;
    const controller = new AbortController();
    active.current = controller;
    requested.current = before;
    setLoading(true);
    setError("");
    const deadline = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await accountFetch(
        `/api/projects/${encodeURIComponent(project.id)}/conversation${before === undefined ? "" : `?before=${before}`}`,
        { signal: controller.signal },
      );
      const result = await response.json();
      if (!response.ok)
        throw new Error(
          result.error || "Saved directions could not be loaded.",
        );
      if (
        !Array.isArray(result.items) ||
        result.items.length > 50 ||
        !Number.isSafeInteger(result.rangeStart) ||
        !Number.isSafeInteger(result.rangeEnd) ||
        !Number.isSafeInteger(result.total)
      )
        throw new Error(
          "Saved directions could not be read. Retry when ready.",
        );
      if (active.current === controller) setSelected(result);
    } catch (failure) {
      if (active.current === controller)
        setError(
          controller.signal.aborted
            ? "Loading saved directions timed out. Retry when ready."
            : failure instanceof SyntaxError
              ? "Saved directions could not be read. Retry when ready."
              : failure instanceof Error
                ? failure.message
                : "Saved directions could not be loaded.",
        );
    } finally {
      clearTimeout(deadline);
      if (active.current === controller) {
        active.current = null;
        setLoading(false);
      }
    }
  }
  return (
    <section className="conversation" aria-label="Creative conversation">
      {page.total > 50 && (
        <div className="conversation-navigation">
          <p>
            Directions {page.rangeStart + 1}–{page.rangeEnd} of {page.total}
          </p>
          <div>
            <button
              type="button"
              className="subtle"
              disabled={loading || page.nextBefore === null}
              onClick={() => void load(page.nextBefore!)}
            >
              Earlier directions
            </button>
            <button
              type="button"
              className="subtle"
              disabled={loading || page.newerBefore === null}
              onClick={() => void load(page.newerBefore!)}
            >
              Newer directions
            </button>
            {selected && (
              <button
                type="button"
                className="subtle"
                disabled={loading}
                onClick={() => void load()}
              >
                Latest directions
              </button>
            )}
          </div>
        </div>
      )}
      {loading && <p role="status">Loading saved directions…</p>}
      {error && (
        <div role="alert">
          <p>{error}</p>
          <button
            type="button"
            className="subtle"
            disabled={loading}
            onClick={() => void load(requested.current)}
          >
            Retry directions
          </button>
        </div>
      )}
      {!!page.unavailable && (
        <p>Some saved direction entries could not be read.</p>
      )}
      {!page.total && <p>No saved directions yet.</p>}
      {page.items.map((message) => (
        <div key={message.index} className={`message ${message.role}`}>
          <small>{message.role === "user" ? "YOU" : "DIRECTOR"}</small>
          <p>{message.content}</p>
        </div>
      ))}
    </section>
  );
}
