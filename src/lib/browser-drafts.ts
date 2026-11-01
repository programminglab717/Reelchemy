import { z } from "zod";
import { timelineSchema, type Project } from "./schema";

export const DRAFT_PREFIX = "reelchemy:browser-draft:v1:";
export const MAX_DRAFT_BYTES = 512 * 1024;
export const MAX_DOWNLOADED_DRAFT_BYTES = 2 * 1024 * 1024;
const draftSchema = z.object({
  version: z.literal(1),
  id: z.uuid(),
  userId: z.string().min(1).max(200),
  projectId: z.uuid(),
  baseRevisionId: z.string().max(200).nullable(),
  updatedAt: z.iso.datetime(),
  timeline: timelineSchema,
});
export type BrowserDraft = z.infer<typeof draftSchema>;
export type DraftStorage = Pick<
  Storage,
  "getItem" | "setItem" | "removeItem" | "key" | "length"
>;
function ownerPrefix(userId: string) {
  return `${DRAFT_PREFIX}${encodeURIComponent(userId)}:`;
}
function key(draft: Pick<BrowserDraft, "userId" | "projectId" | "id">) {
  return `${ownerPrefix(draft.userId)}${draft.projectId}:${draft.id}`;
}
export function createBrowserDraft(
  userId: string,
  project: Project,
  id: string,
): BrowserDraft {
  return draftSchema.parse({
    version: 1,
    id,
    userId,
    projectId: project.id,
    baseRevisionId: project.revisions.at(-1)?.id ?? null,
    updatedAt: new Date().toISOString(),
    timeline: project.timeline,
  });
}
export function parseDownloadedDraft(
  text: string,
  userId: string,
  projectId: string,
): BrowserDraft {
  if (new TextEncoder().encode(text).length > MAX_DOWNLOADED_DRAFT_BYTES)
    throw new Error("Recovery files must be 2 MiB or smaller.");
  let draft: BrowserDraft;
  try {
    const data = JSON.parse(text);
    if (data && typeof data === "object" && "version" in data)
      draft = draftSchema.parse(data);
    else {
      // Earlier versions downloaded the entire unsaved project as JSON. Read
      // only its timeline/base; never import media paths, messages or history.
      const legacy = z
        .object({
          id: z.uuid(),
          timeline: timelineSchema,
          revisions: z
            .array(z.object({ id: z.string().max(200) }))
            .max(10000)
            .optional(),
        })
        .parse(data);
      draft = draftSchema.parse({
        version: 1,
        id: crypto.randomUUID(),
        userId,
        projectId: legacy.id,
        timeline: legacy.timeline,
        baseRevisionId: legacy.revisions?.at(-1)?.id ?? null,
        updatedAt: new Date().toISOString(),
      });
    }
  } catch {
    throw new Error(
      "This file does not contain a supported timeline recovery copy.",
    );
  }
  if (draft.userId !== userId || draft.projectId !== projectId)
    throw new Error(
      "This recovery copy belongs to a different account or project. Open its original project, or use an editable project ZIP to transfer work.",
    );
  return draft;
}
export function writeBrowserDraft(storage: DraftStorage, draft: BrowserDraft) {
  const value = JSON.stringify(draftSchema.parse(draft));
  if (new TextEncoder().encode(value).length > MAX_DRAFT_BYTES)
    throw new Error("Browser draft is too large.");
  // Separate IDs preserve drafts from concurrent tabs. Never evict other work
  // to make room: a full/disabled browser store is surfaced to the editor.
  storage.setItem(key(draft), value);
}
export function removeBrowserDraft(storage: DraftStorage, draft: BrowserDraft) {
  const existing = storage.getItem(key(draft));
  if (!existing) return;
  // A different tab may have updated this record since it was offered for
  // recovery. Only discard the exact version the user selected or saved.
  if (existing === JSON.stringify(draft)) storage.removeItem(key(draft));
}
export function listBrowserDrafts(
  storage: DraftStorage,
  userId: string,
  projectId: string,
) {
  const prefix = `${ownerPrefix(userId)}${projectId}:`;
  const drafts: BrowserDraft[] = [];
  for (let i = 0; i < storage.length; i++) {
    const name = storage.key(i);
    if (!name?.startsWith(prefix)) continue;
    const value = storage.getItem(name);
    if (!value || new TextEncoder().encode(value).length > MAX_DRAFT_BYTES)
      continue;
    try {
      const draft = draftSchema.parse(JSON.parse(value));
      if (
        draft.userId === userId &&
        draft.projectId === projectId &&
        key(draft) === name
      )
        drafts.push(draft);
    } catch {
      // Browser contents are untrusted. Invalid records never enter an editor.
    }
  }
  return drafts.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}
function ownerKeys(storage: DraftStorage, userId: string) {
  const prefix = ownerPrefix(userId);
  const names: string[] = [];
  for (let i = 0; i < storage.length; i++) {
    const name = storage.key(i);
    if (name?.startsWith(prefix)) names.push(name);
  }
  return names;
}
export function countBrowserDrafts(storage: DraftStorage, userId: string) {
  return ownerKeys(storage, userId).length;
}
export function clearBrowserDrafts(storage: DraftStorage, userId: string) {
  for (const name of ownerKeys(storage, userId)) storage.removeItem(name);
}
export function clearProjectBrowserDrafts(
  storage: DraftStorage,
  userId: string,
  projectId: string,
) {
  const prefix = `${ownerPrefix(userId)}${projectId}:`;
  for (const name of ownerKeys(storage, userId))
    if (name.startsWith(prefix)) storage.removeItem(name);
}
