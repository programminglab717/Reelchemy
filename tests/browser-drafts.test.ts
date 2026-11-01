import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  DRAFT_PREFIX,
  MAX_DRAFT_BYTES,
  createBrowserDraft,
  writeBrowserDraft,
  listBrowserDrafts,
  removeBrowserDraft,
  clearBrowserDrafts,
  countBrowserDrafts,
  parseDownloadedDraft,
  MAX_DOWNLOADED_DRAFT_BYTES,
  type DraftStorage,
} from "../src/lib/browser-drafts";
import { blankTimeline } from "../src/lib/editor";
import type { Project } from "../src/lib/schema";

class MemoryStorage implements DraftStorage {
  values = new Map<string, string>();
  get length() {
    return this.values.size;
  }
  key(index: number) {
    return [...this.values.keys()][index] ?? null;
  }
  getItem(name: string) {
    return this.values.get(name) ?? null;
  }
  setItem(name: string, value: string) {
    this.values.set(name, value);
  }
  removeItem(name: string) {
    this.values.delete(name);
  }
}
function project(): Project {
  const brief = {
    prompt: "Private browser work",
    duration: 5,
    format: "landscape" as const,
  };
  const timeline = blankTimeline(brief);
  return {
    id: randomUUID(),
    name: "My story",
    createdAt: new Date().toISOString(),
    brief,
    timeline,
    revisions: [
      {
        id: randomUUID(),
        createdAt: new Date().toISOString(),
        source: "Manual",
        timeline,
      },
    ],
    messages: [],
    assets: [],
  };
}
test("browser recovery copies retain the saved base and separate concurrent tabs, projects and accounts", () => {
  const storage = new MemoryStorage();
  const p = project();
  const first = createBrowserDraft("owner:a", p, randomUUID());
  const second = createBrowserDraft("owner:a", p, randomUUID());
  second.timeline.scenes[0].title = "A different tab";
  const otherProject = createBrowserDraft("owner:a", project(), randomUUID());
  const otherUser = createBrowserDraft("owner:b", p, randomUUID());
  for (const draft of [first, second, otherProject, otherUser])
    writeBrowserDraft(storage, draft);
  assert.equal(listBrowserDrafts(storage, "owner:a", p.id).length, 2);
  assert.equal(listBrowserDrafts(storage, "owner:b", p.id).length, 1);
  assert.equal(listBrowserDrafts(storage, "owner", p.id).length, 0);
  assert.equal(first.baseRevisionId, p.revisions[0].id);
  assert.equal(first.timeline.scenes[0].title, "Scene 1");
  removeBrowserDraft(storage, first);
  assert.deepEqual(listBrowserDrafts(storage, "owner:a", p.id), [second]);
  storage.setItem("unrelated-browser-data", "keep");
  assert.equal(countBrowserDrafts(storage, "owner:a"), 2);
  clearBrowserDrafts(storage, "owner:a");
  assert.equal(storage.length, 2);
  assert.equal(storage.getItem("unrelated-browser-data"), "keep");
  assert.deepEqual(listBrowserDrafts(storage, "owner:b", p.id), [otherUser]);
});
test("discard/save cannot erase a recovery copy changed since it was selected", () => {
  const storage = new MemoryStorage();
  const p = project();
  const old = createBrowserDraft("owner", p, randomUUID());
  writeBrowserDraft(storage, old);
  const newer = structuredClone(old);
  newer.timeline.scenes[0].title = "New work in the other tab";
  writeBrowserDraft(storage, newer);
  removeBrowserDraft(storage, old);
  assert.deepEqual(listBrowserDrafts(storage, "owner", p.id), [newer]);
  removeBrowserDraft(storage, newer);
  assert.equal(storage.length, 0);
});
test("untrusted or oversized browser values never become editable recovery copies", () => {
  const storage = new MemoryStorage();
  const p = project();
  const draft = createBrowserDraft("owner", p, randomUUID());
  writeBrowserDraft(storage, draft);
  const name = storage.key(0)!;
  for (const value of [
    "not-json",
    "x".repeat(MAX_DRAFT_BYTES + 1),
    JSON.stringify({ ...draft, userId: "another-owner" }),
    JSON.stringify({ ...draft, projectId: randomUUID() }),
    JSON.stringify({ ...draft, id: randomUUID() }),
    JSON.stringify({ ...draft, version: 2 }),
    JSON.stringify({ ...draft, timeline: { ...draft.timeline, scenes: [] } }),
  ]) {
    storage.setItem(name, value);
    assert.deepEqual(listBrowserDrafts(storage, "owner", p.id), []);
  }
  assert(name.startsWith(DRAFT_PREFIX));
});
test("full or unavailable browser storage preserves existing work and reports failure without eviction", () => {
  const storage = new MemoryStorage();
  const p = project();
  const draft = createBrowserDraft("owner", p, randomUUID());
  writeBrowserDraft(storage, draft);
  const before = [...storage.values];
  const full = Object.assign(storage, {
    setItem() {
      throw new Error("QuotaExceededError");
    },
  });
  assert.throws(
    () => writeBrowserDraft(full, { ...draft, id: randomUUID() }),
    /QuotaExceeded/,
  );
  assert.deepEqual([...storage.values], before);
  const huge = structuredClone(draft);
  huge.timeline.scenes[0].layers[0].assetId = "x".repeat(MAX_DRAFT_BYTES + 1);
  assert.throws(
    () => writeBrowserDraft(new MemoryStorage(), huge),
    /too large/,
  );
});
test("downloaded recovery JSON is scoped and legacy files import only validated timelines", () => {
  const p = project();
  const draft = createBrowserDraft("owner", p, randomUUID());
  assert.deepEqual(
    parseDownloadedDraft(JSON.stringify(draft), "owner", p.id),
    draft,
  );
  const legacy = {
    ...p,
    assets: [{ source: "private-path-canary" }],
    messages: [{ role: "user", content: "private-message-canary" }],
  };
  const imported = parseDownloadedDraft(JSON.stringify(legacy), "owner", p.id);
  assert.deepEqual(imported.timeline, p.timeline);
  assert.equal(imported.baseRevisionId, p.revisions[0].id);
  assert(!JSON.stringify(imported).includes("private-path-canary"));
  assert(!JSON.stringify(imported).includes("private-message-canary"));
  assert.throws(
    () => parseDownloadedDraft(JSON.stringify(draft), "another-owner", p.id),
    /different account or project/,
  );
  assert.throws(
    () => parseDownloadedDraft(JSON.stringify(draft), "owner", randomUUID()),
    /different account or project/,
  );
  for (const invalid of [
    "invalid-json-canary",
    JSON.stringify({ ...draft, version: 2 }),
    JSON.stringify({ ...legacy, timeline: { fps: "private-error-canary" } }),
  ]) {
    assert.throws(
      () => parseDownloadedDraft(invalid, "owner", p.id),
      (error) =>
        error instanceof Error &&
        error.message ===
          "This file does not contain a supported timeline recovery copy.",
    );
  }
  assert.throws(
    () =>
      parseDownloadedDraft(
        "x".repeat(MAX_DOWNLOADED_DRAFT_BYTES + 1),
        "owner",
        p.id,
      ),
    /2 MiB/,
  );
});
