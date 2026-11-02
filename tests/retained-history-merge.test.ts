import { test } from "node:test";
import assert from "node:assert/strict";
import type { EditorProject } from "../src/lib/project-view";
import { mergeRetainedHistory } from "../src/lib/retained-history-merge";
import { blankTimeline, editHistory } from "../src/lib/editor";
const current = (): EditorProject => {
  const brief = {
    prompt: "Keep my unsaved work",
    duration: 5,
    format: "portrait" as const,
  };
  return {
    id: "private-project",
    name: "Current name",
    brief,
    createdAt: "2026-11-02T00:00:00.000Z",
    timeline: blankTimeline(brief),
    revisions: [
      { id: "older", source: "Edit", createdAt: null },
      { id: "base", source: "Edit", createdAt: null },
    ],
    revisionCount: 600,
    messages: [{ role: "user", content: "Unsaved direction view" }],
    messageCount: 1001,
    messageStart: 951,
    assets: [],
  };
};
test("retained metadata refresh preserves the current film, assets, name, brief and exact undo/recovery source while updating saved history counts", () => {
  const local = current(),
    source = structuredClone(local),
    state = {
      past: [structuredClone(local.timeline!)],
      present: local.timeline!,
      future: [],
    };
  const remote = {
    ...current(),
    name: "Remote name must not replace it",
    timeline: null,
    revisions: current().revisions.slice(-1),
    revisionCount: 1,
    messages: [{ role: "assistant" as const, content: "Retained direction" }],
    messageCount: 1,
    messageStart: 0,
  };
  const merged = mergeRetainedHistory(local, remote, "base")!;
  assert(merged);
  assert.strictEqual(merged.timeline, local.timeline);
  assert.strictEqual(merged.assets, local.assets);
  assert.strictEqual(merged.brief, local.brief);
  assert.equal(merged.name, local.name);
  assert.equal(merged.revisionCount, 1);
  assert.deepEqual(merged.messages, remote.messages);
  assert.equal(merged.messageStart, 0);
  assert.deepEqual(local, source);
  assert.equal(editHistory(state, "undo").present, state.past[0]);
});
test("history refresh never adopts another writer's revision or data from another project, including a save that finishes before the refresh", () => {
  const local = current(),
    next = {
      ...current(),
      revisions: [{ id: "newer", source: "Other writer", createdAt: null }],
    };
  assert.equal(mergeRetainedHistory(local, next, "base"), null);
  assert.equal(mergeRetainedHistory(next, local, "base"), null);
  assert.equal(
    mergeRetainedHistory(local, { ...local, id: "foreign" }, "base"),
    null,
  );
  assert.equal(mergeRetainedHistory(local, local, "unexpected"), null);
});
