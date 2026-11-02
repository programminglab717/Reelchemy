"use client";
import { useAccountFetch } from "./AccountBoundary";
import { useCallback, useEffect, useRef, useState } from "react";
import { editHistory, revisionId, type EditHistory } from "@/lib/editor";
import type { Project, Timeline } from "@/lib/schema";
import type { AssetUpdate } from "@/lib/project-assets";
import {
  createBrowserDraft,
  writeBrowserDraft,
  listBrowserDrafts,
  removeBrowserDraft,
  clearBrowserDrafts,
  countBrowserDrafts,
  type BrowserDraft,
} from "@/lib/browser-drafts";

export function useProjectEditor(userId: string) {
  const accountFetch = useAccountFetch();
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
  const draftId = useRef("");
  const ownDraft = useRef<BrowserDraft | null>(null);
  const recoveredDraft = useRef<BrowserDraft | null>(null);
  const [browserDrafts, setBrowserDrafts] = useState<BrowserDraft[]>([]);
  const [draftError, setDraftError] = useState("");
  const draftFailure = () =>
    setDraftError(
      "This browser could not keep a recovery copy. Download your unsaved draft before closing if saving fails.",
    );
  const persistDraft = useCallback(
    (p: Project) => {
      if (!p.timeline) return;
      try {
        if (JSON.stringify(p.timeline) === saved.current) {
          if (ownDraft.current)
            removeBrowserDraft(window.localStorage, ownDraft.current);
          ownDraft.current = null;
        } else {
          const draft = createBrowserDraft(userId, p, draftId.current);
          writeBrowserDraft(window.localStorage, draft);
          ownDraft.current = draft;
        }
        setDraftError("");
      } catch {
        draftFailure();
      }
    },
    [userId],
  );
  const refreshDrafts = useCallback(
    (p: Project | null) => {
      if (!p) {
        setBrowserDrafts([]);
        return;
      }
      try {
        const found = listBrowserDrafts(window.localStorage, userId, p.id);
        const pending: BrowserDraft[] = [];
        for (const draft of found) {
          if (JSON.stringify(draft.timeline) === saved.current)
            removeBrowserDraft(window.localStorage, draft);
          else if (draft.id !== draftId.current) pending.push(draft);
        }
        setBrowserDrafts(pending);
      } catch {
        draftFailure();
      }
    },
    [userId],
  );
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
      draftId.current = crypto.randomUUID();
      ownDraft.current = null;
      recoveredDraft.current = null;
      setDraftError("");
      publish(p);
      refreshDrafts(p);
    },
    [publish, refreshDrafts],
  );
  const change = useCallback(
    (action: Timeline | "undo" | "redo") => {
      if (!current.current || !edits.current) return;
      try {
        const next = editHistory(edits.current, action);
        if (next === edits.current) return;
        edits.current = next;
        setHistory(next);
        const p = { ...current.current, timeline: next.present };
        publish(p);
        persistDraft(p);
        if (!blocked.current) setSaveError("");
      } catch {
        setSaveError(
          "That edit does not fit the timeline limits. Adjust the values and try again.",
        );
      }
    },
    [publish, persistDraft],
  );
  const mergeAssets = useCallback(
    (p: AssetUpdate) => {
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
          const response = await accountFetch(`/api/projects/${draft.id}`, {
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
          const merged = {
            ...result,
            timeline: current.current.timeline,
            assets: [...assets.values()],
          };
          saved.current = snapshot;
          publish(merged);
          persistDraft(merged);
          if (recoveredDraft.current) {
            try {
              removeBrowserDraft(window.localStorage, recoveredDraft.current);
            } catch {
              draftFailure();
            }
            recoveredDraft.current = null;
            refreshDrafts(merged);
          }
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
  }, [publish, persistDraft, refreshDrafts, accountFetch]);
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
  useEffect(() => {
    const refresh = () => refreshDrafts(current.current);
    window.addEventListener("storage", refresh);
    return () => window.removeEventListener("storage", refresh);
  }, [refreshDrafts]);
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
    draftError,
    browserDrafts,
    recoverDraft: (draft: BrowserDraft) => {
      const p = current.current;
      if (
        !p ||
        p.id !== draft.projectId ||
        draft.userId !== userId ||
        JSON.stringify(p.timeline) !== saved.current ||
        flight.current
      )
        throw new Error(
          "Save your current edits before recovering another draft.",
        );
      recoveredDraft.current = draft;
      change(draft.timeline);
    },
    discardDraft: (draft?: BrowserDraft) => {
      try {
        const target = draft || ownDraft.current;
        if (target) removeBrowserDraft(window.localStorage, target);
        if (!draft) ownDraft.current = null;
        refreshDrafts(current.current);
      } catch {
        draftFailure();
      }
    },
    clearBrowserDrafts: () => {
      try {
        clearBrowserDrafts(window.localStorage, userId);
      } catch {
        draftFailure();
      }
    },
    browserDraftCount: () => {
      try {
        return countBrowserDrafts(window.localStorage, userId);
      } catch {
        return null;
      }
    },
    canUndo: !!history?.past.length,
    canRedo: !!history?.future.length,
  };
}
