"use client";
import { useEffect, useRef, useState } from "react";
import { useAccountFetch } from "./AccountBoundary";
import type { EditorProject } from "@/lib/project-view";
import type {
  ProjectRetentionPlan,
  ProjectRetentionResult,
} from "@/lib/project-retention";
type Usage = {
  projectId: string;
  bytes: number;
  versions: number;
  messages: number;
  limitBytes: number;
  limitVersions: number;
  limitMessages: number;
  studio: {
    bytes: number;
    projects: number;
    limitBytes: number;
    limitProjects: number;
  };
};
const amount = (bytes: number) =>
  bytes >= 1024 ** 2
    ? `${(bytes / 1024 ** 2).toFixed(1)} MB`
    : `${(bytes / 1024).toFixed(1)} KB`;
const integer = (value: unknown, min = 0, max = Number.MAX_SAFE_INTEGER) =>
  typeof value === "number" &&
  Number.isSafeInteger(value) &&
  value >= min &&
  value <= max;
export function ProjectHistoryStorage({
  projectId,
  latestRevisionId,
  disabled,
  onOpen,
  onHistory,
}: {
  projectId: string;
  latestRevisionId: string | null;
  disabled: boolean;
  onOpen: () => void;
  onHistory: (p: EditorProject, expected: string | null) => boolean;
}) {
  const request = useAccountFetch(),
    dialog = useRef<HTMLDialogElement>(null),
    opener = useRef<HTMLButtonElement>(null);
  const [usage, setUsage] = useState<Usage | null>(null),
    [usageError, setUsageError] = useState(""),
    [refresh, setRefresh] = useState(0);
  const [open, setOpen] = useState(false),
    [working, setWorking] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [keepVersions, setKeepVersions] = useState(20),
    [keepMessages, setKeepMessages] = useState(100),
    [confirmed, setConfirmed] = useState(false);
  const [plan, setPlan] = useState<ProjectRetentionPlan | null>(null),
    [pending, setPending] = useState<{
      plan: ProjectRetentionPlan;
      requestId: string;
    } | null>(null),
    [completed, setCompleted] = useState<{
      result: ProjectRetentionResult;
      expected: string | null;
    } | null>(null);
  const active = useRef(new Set<AbortController>()),
    mounted = useRef(true);
  const endpoint = `/api/projects/${encodeURIComponent(projectId)}/retention`;
  useEffect(() => {
    mounted.current = true;
    const controllers = active.current;
    return () => {
      mounted.current = false;
      for (const controller of controllers) controller.abort();
    };
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await request(endpoint, {
          signal: AbortSignal.any([
            controller.signal,
            AbortSignal.timeout(15000),
          ]),
        });
        const value = await response.json();
        if (!response.ok)
          throw new Error(
            value.error || "Saved project allowance is unavailable.",
          );
        if (
          value.projectId !== projectId ||
          !integer(value.bytes) ||
          !integer(value.limitBytes, 1) ||
          !integer(value.limitVersions, 1) ||
          !integer(value.limitMessages, 1) ||
          !integer(value.versions) ||
          !integer(value.messages) ||
          !integer(value.studio?.bytes) ||
          !integer(value.studio?.projects) ||
          !integer(value.studio?.limitBytes, 1) ||
          !integer(value.studio?.limitProjects, 1)
        )
          throw new Error(
            "The saved project allowance response was incomplete.",
          );
        if (!controller.signal.aborted) {
          setUsage(value);
          setUsageError("");
        }
      } catch (problem) {
        if (!controller.signal.aborted)
          setUsageError(
            problem instanceof Error
              ? problem.message
              : "Saved project allowance is unavailable.",
          );
      }
    })();
    return () => controller.abort();
  }, [endpoint, projectId, latestRevisionId, refresh, request]);
  useEffect(() => {
    if (!open) return;
    const element = dialog.current,
      button = opener.current;
    element?.showModal();
    return () => {
      element?.close();
      if (button?.isConnected) button.focus();
    };
  }, [open]);
  async function json(url: string, init?: RequestInit) {
    const controller = new AbortController();
    active.current.add(controller);
    try {
      const response = await request(url, {
        ...init,
        signal: AbortSignal.any([
          controller.signal,
          AbortSignal.timeout(15000),
        ]),
      });
      const value = await response.json();
      return { response, value };
    } finally {
      active.current.delete(controller);
    }
  }
  async function review() {
    setWorking(true);
    setError("");
    setNotice("");
    setPlan(null);
    setConfirmed(false);
    setCompleted(null);
    try {
      const query = new URLSearchParams({
        preview: "1",
        keepVersions: String(keepVersions),
        keepMessages: String(keepMessages),
      });
      const { response, value } = await json(`${endpoint}?${query}`);
      if (!response.ok)
        throw new Error(value.error || "Cleanup preview could not be loaded.");
      if (
        value.projectId !== projectId ||
        value.keepVersions !== keepVersions ||
        value.keepMessages !== keepMessages ||
        !/^[a-f0-9]{64}$/.test(value.digest) ||
        !integer(value.versionsBefore) ||
        !integer(value.messagesBefore) ||
        !integer(value.versionsAfter, 0, value.versionsBefore) ||
        !integer(value.messagesAfter, 0, value.messagesBefore) ||
        value.versionsAfter !==
          Math.min(value.keepVersions, value.versionsBefore) ||
        value.messagesAfter !==
          Math.min(value.keepMessages, value.messagesBefore) ||
        !integer(value.bytesBefore) ||
        !integer(value.bytesAfter, 0, value.bytesBefore)
      )
        throw new Error(
          "Cleanup preview was incomplete. No saved history was removed.",
        );
      if (value.latestRevisionId !== latestRevisionId)
        throw new Error(
          "The saved film changed. Keep your recovery copy and open the latest saved version before cleaning its history.",
        );
      if (mounted.current) setPlan(value);
    } catch (problem) {
      if (mounted.current)
        setError(
          problem instanceof Error
            ? problem.message
            : "Cleanup preview could not be loaded.",
        );
    } finally {
      if (mounted.current) setWorking(false);
    }
  }
  async function refreshHistory(expected: string | null) {
    const { response, value } = await json(
      `/api/projects/${encodeURIComponent(projectId)}`,
    );
    if (!response.ok)
      throw new Error(value.error || "Saved history could not be refreshed.");
    if (
      value.id !== projectId ||
      !Array.isArray(value.revisions) ||
      value.revisions.length > 20 ||
      !value.revisions.every(
        (r: { id?: unknown }) => typeof r?.id === "string",
      ) ||
      !Array.isArray(value.messages) ||
      value.messages.length > 50 ||
      !value.messages.every(
        (message: { role?: unknown; content?: unknown }) =>
          (message?.role === "user" || message?.role === "assistant") &&
          typeof message.content === "string" &&
          message.content.length <= 16000,
      ) ||
      !integer(value.revisionCount) ||
      !integer(value.messageCount)
    )
      throw new Error("Saved history refresh was incomplete.");
    if (!mounted.current) return false;
    const merged = onHistory(value, expected);
    if (!merged)
      setNotice(
        "Cleanup completed. A newer saved edit arrived; your local edits are kept. Reopen the saved-version browser to review the current history.",
      );
    return merged;
  }
  async function clean() {
    const action =
      pending || (plan ? { plan, requestId: crypto.randomUUID() } : null);
    if (!action) return;
    setPending(action);
    setWorking(true);
    setError("");
    try {
      const { response, value } = await json(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          keepVersions: action.plan.keepVersions,
          keepMessages: action.plan.keepMessages,
          digest: action.plan.digest,
          requestId: action.requestId,
          confirmation: "REMOVE EARLIER HISTORY",
        }),
      });
      if (!response.ok) {
        if ([400, 401, 404, 409, 422].includes(response.status)) {
          setPending(null);
          setPlan(null);
          setConfirmed(false);
        }
        throw new Error(
          value.error ||
            "The cleanup response was interrupted. Retry the same cleanup to check its result.",
        );
      }
      if (
        value.projectId !== projectId ||
        value.requestId !== action.requestId ||
        value.versionsRemoved !==
          action.plan.versionsBefore - action.plan.versionsAfter ||
        value.messagesRemoved !==
          action.plan.messagesBefore - action.plan.messagesAfter ||
        !integer(value.bytesFreed, 0, action.plan.bytesBefore)
      )
        throw new Error(
          "The cleanup result was incomplete. Retry the same cleanup to check its result.",
        );
      if (!mounted.current) return;
      setCompleted({ result: value, expected: action.plan.latestRevisionId });
      setPending(null);
      setPlan(null);
      setConfirmed(false);
      setRefresh((n) => n + 1);
      try {
        await refreshHistory(action.plan.latestRevisionId);
      } catch {
        if (mounted.current)
          setNotice(
            "Cleanup completed. Refresh saved history to update the editor's counts; your current film and edits are kept.",
          );
      }
    } catch (problem) {
      if (mounted.current)
        setError(
          problem instanceof Error
            ? problem.message
            : "Cleanup was interrupted. Retry the same cleanup to check its result.",
        );
    } finally {
      if (mounted.current) setWorking(false);
    }
  }
  return (
    <section className="media-storage" aria-label="Saved project storage">
      <div className="media-storage-title">
        <strong>Saved project allowance</strong>
        <button
          type="button"
          className="subtle"
          aria-label="Refresh saved project allowance"
          onClick={() => setRefresh((n) => n + 1)}
        >
          Refresh
        </button>
      </div>
      {usage && (
        <>
          <p role="status" aria-label="Saved project storage usage">
            {amount(usage.bytes)} of {amount(usage.limitBytes)} ·{" "}
            {usage.versions} of {usage.limitVersions} saved versions ·{" "}
            {usage.messages} of {usage.limitMessages} directions
          </p>
          <progress
            aria-label="Retained project data allowance"
            value={Math.min(usage.bytes, usage.limitBytes)}
            max={usage.limitBytes}
          />
          <small>
            Your studio uses {amount(usage.studio.bytes)} of{" "}
            {amount(usage.studio.limitBytes)} across {usage.studio.projects} of{" "}
            {usage.studio.limitProjects} projects, including Trash. Media and
            exports have separate storage.
          </small>
        </>
      )}
      {usageError && <p role="alert">{usageError}</p>}
      <button
        ref={opener}
        type="button"
        className="subtle"
        disabled={disabled}
        onClick={() => {
          onOpen();
          if (!pending) {
            if (usage) {
              setKeepVersions((n) =>
                Math.min(n, Math.max(1, usage.limitVersions - 1)),
              );
              setKeepMessages((n) =>
                Math.min(n, Math.max(1, usage.limitMessages - 2)),
              );
            }
            setCompleted(null);
            setPlan(null);
            setConfirmed(false);
            setError("");
            setNotice("");
          }
          setOpen(true);
        }}
      >
        Manage saved history
      </button>
      {open && (
        <dialog
          ref={dialog}
          className="delete-project-dialog history-cleanup-dialog"
          aria-labelledby="history-cleanup-title"
          onCancel={(event) => {
            event.preventDefault();
            if (!working) setOpen(false);
          }}
        >
          <h2 id="history-cleanup-title">Manage saved history</h2>
          <p>
            Keep recent saved versions and directions, and remove earlier ones
            to free your project allowance. Your current saved film, unsaved
            edits, undo, uploaded media and finished exports stay available.
          </p>
          {!completed && (
            <>
              <label>
                Saved versions to keep
                <input
                  aria-label="Saved versions to keep"
                  type="number"
                  min={1}
                  max={10000}
                  value={keepVersions}
                  disabled={working || !!pending}
                  onChange={(event) => {
                    setKeepVersions(Number(event.target.value));
                    setPlan(null);
                    setConfirmed(false);
                  }}
                />
              </label>
              <label>
                Directions to keep
                <input
                  aria-label="Directions to keep"
                  type="number"
                  min={1}
                  max={10000}
                  value={keepMessages}
                  disabled={working || !!pending}
                  onChange={(event) => {
                    setKeepMessages(Number(event.target.value));
                    setPlan(null);
                    setConfirmed(false);
                  }}
                />
              </label>
              <button
                type="button"
                className="subtle"
                disabled={
                  working ||
                  disabled ||
                  !!pending ||
                  !integer(keepVersions, 1, 10000) ||
                  !integer(keepMessages, 1, 10000)
                }
                onClick={() => void review()}
              >
                Preview history cleanup
              </button>
            </>
          )}
          {plan && !completed && (
            <div aria-label="History cleanup preview">
              <p>
                Remove {plan.versionsBefore - plan.versionsAfter} earlier saved
                versions and {plan.messagesBefore - plan.messagesAfter}{" "}
                directions. Keep {plan.versionsAfter} versions and{" "}
                {plan.messagesAfter} directions. Free approximately{" "}
                {amount(plan.bytesBefore - plan.bytesAfter)} of saved project
                data.
              </p>
              <small>
                This cleanup cannot be undone in the app. Existing backups may
                retain earlier history. Download an editable project first if
                you want a separate copy. Retained versions are renumbered;
                their dates and the current saved edit stay unchanged.
              </small>
              <label>
                <input
                  type="checkbox"
                  checked={confirmed}
                  disabled={working || !!pending}
                  onChange={(event) => setConfirmed(event.target.checked)}
                />
                I understand that earlier saved history will be removed.
              </label>
            </div>
          )}
          {error && <p role="alert">{error}</p>}
          {notice && <p role="status">{notice}</p>}
          {completed && (
            <>
              <p role="status">
                Removed {completed.result.versionsRemoved} saved versions and{" "}
                {completed.result.messagesRemoved} directions. Freed{" "}
                {amount(completed.result.bytesFreed)}. Your current film is
                kept. Use Save now to retry any unsaved edit.
              </p>
              {notice && (
                <button
                  type="button"
                  className="subtle"
                  disabled={working}
                  onClick={() => {
                    setWorking(true);
                    void refreshHistory(completed.expected)
                      .then((merged) => {
                        if (merged && mounted.current) setNotice("");
                      })
                      .catch(() => {
                        if (mounted.current)
                          setNotice(
                            "History refresh is unavailable. Your current edits are kept; try again.",
                          );
                      })
                      .finally(() => {
                        if (mounted.current) setWorking(false);
                      });
                  }}
                >
                  Refresh saved history
                </button>
              )}
            </>
          )}
          <div className="dialog-actions">
            <button
              type="button"
              className="subtle"
              disabled={working}
              onClick={() => setOpen(false)}
            >
              {completed ? "Done" : "Close"}
            </button>
            {!completed && (
              <button
                type="button"
                disabled={
                  working ||
                  disabled ||
                  (!pending &&
                    (!confirmed ||
                      !plan ||
                      (plan.versionsBefore === plan.versionsAfter &&
                        plan.messagesBefore === plan.messagesAfter)))
                }
                onClick={() => void clean()}
              >
                {working
                  ? "Working…"
                  : pending
                    ? "Retry same cleanup"
                    : "Remove earlier history"}
              </button>
            )}
          </div>
        </dialog>
      )}
    </section>
  );
}
