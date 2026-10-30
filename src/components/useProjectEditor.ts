"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { editHistory, revisionId, type EditHistory } from "@/lib/editor";
import type { Project, Timeline } from "@/lib/schema";

export function useProjectEditor() {
  const [project, setProject] = useState<Project | null>(null);
  const [history, setHistory] = useState<EditHistory | null>(null);
  const [baseline, setBaseline] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const current = useRef<Project | null>(null);
  const saved = useRef("");
  const edits = useRef<EditHistory | null>(null);
  const blocked = useRef(false);
  const flight = useRef<Promise<void> | null>(null);
  const publish = useCallback((p: Project | null) => {
    current.current = p;
    setProject(p);
  }, []);
  const open = useCallback(
    (p: Project | null) => {
      saved.current = JSON.stringify(p?.timeline);
      setBaseline(saved.current);
      edits.current = p?.timeline
        ? { past: [], present: p.timeline, future: [] }
        : null;
      setHistory(edits.current);
      blocked.current = false;
      setSaveError("");
      publish(p);
    },
    [publish],
  );
  const change = useCallback(
    (action: Timeline | "undo" | "redo") => {
      if (!current.current || !edits.current) return;
      try {
        const next = editHistory(edits.current, action);
        if (next === edits.current) return;
        edits.current = next;
        setHistory(next);
        publish({ ...current.current, timeline: next.present });
        if (!blocked.current) setSaveError("");
      } catch {
        setSaveError(
          "That edit does not fit the timeline limits. Adjust the values and try again.",
        );
      }
    },
    [publish],
  );
  const mergeAssets = useCallback(
    (p: Project) => {
      if (current.current?.id !== p.id) return;
      const assets = new Map(
        [...(current.current.assets || []), ...(p.assets || [])].map((a) => [
          a.id,
          a,
        ]),
      );
      publish({ ...current.current, assets: [...assets.values()] });
    },
    [publish],
  );
  const mergeName = useCallback(
    (p: Project) => {
      if (current.current?.id === p.id)
        publish({ ...current.current, name: p.name });
    },
    [publish],
  );
  const save = useCallback(async () => {
    if (flight.current) return flight.current;
    if (blocked.current)
      throw new Error(
        "Open the latest version after downloading your draft to resolve the save conflict.",
      );
    const task = async () => {
      setSaving(true);
      try {
        // Serialize saves. A response updates the baseline, never a newer local edit.
        while (
          current.current?.timeline &&
          JSON.stringify(current.current.timeline) !== saved.current
        ) {
          const draft = current.current;
          const snapshot = JSON.stringify(draft.timeline);
          const response = await fetch(`/api/projects/${draft.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              timeline: draft.timeline,
              baseRevisionId: revisionId(draft),
            }),
          });
          const result = await response.json();
          if (!response.ok) {
            if (response.status === 409) blocked.current = true;
            throw new Error(
              result.error || "Saving failed. Your edits are still here.",
            );
          }
          if (current.current?.id !== draft.id) return;
          const assets = new Map(
            [...(result.assets || []), ...(current.current.assets || [])].map(
              (a) => [a.id, a],
            ),
          );
          publish({
            ...result,
            timeline: current.current.timeline,
            assets: [...assets.values()],
          });
          saved.current = snapshot;
          setBaseline(snapshot);
          setSaveError("");
        }
      } catch (e) {
        setSaveError(
          e instanceof Error
            ? e.message
            : "Saving failed. Your edits are still here.",
        );
        throw e;
      } finally {
        setSaving(false);
      }
    };
    flight.current = task();
    try {
      await flight.current;
    } finally {
      flight.current = null;
    }
  }, [publish]);
  const dirty =
    !!project?.timeline && JSON.stringify(project.timeline) !== baseline;
  useEffect(() => {
    if (!dirty || saveError) return;
    const timer = setTimeout(() => {
      void save().catch(() => {});
    }, 900);
    return () => clearTimeout(timer);
  }, [project, dirty, saveError, save]);
  useEffect(() => {
    if (!dirty) return;
    const prevent = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", prevent);
    return () => window.removeEventListener("beforeunload", prevent);
  }, [dirty]);
  return {
    project,
    open,
    change,
    mergeAssets,
    mergeName,
    save,
    getCurrent: () => current.current,
    markConflict: (message: string) => {
      blocked.current = true;
      setSaveError(message);
    },
    dirty,
    saving,
    saveError,
    canUndo: !!history?.past.length,
    canRedo: !!history?.future.length,
  };
}
