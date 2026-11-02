import type { Project, Revision } from "./schema";
export const PROJECT_VIEW_HEADER = "X-Reelchemy-Project-View";
export const EDITOR_PROJECT_VIEW = "editor-v1";
export type EditorMessage = Project["messages"][number] & { index?: number };
// Full legacy Project responses are structurally compatible. A declared editor
// response includes counts and metadata-only revisions; it is never a Project
// with fabricated historical timelines.
export type EditorProject = Omit<Project, "revisions" | "messages"> & {
  revisions: (Pick<Revision, "id" | "source"> & {
    createdAt: string | null;
    number?: number;
  })[];
  messages: EditorMessage[];
  revisionCount?: number;
  messageCount?: number;
  messageStart?: number;
  messageUnavailable?: number;
};
export type ConversationPage = {
  items: (EditorMessage & { index: number })[];
  total: number;
  rangeStart: number;
  rangeEnd: number;
  nextBefore: number | null;
  newerBefore: number | null;
  unavailable: number;
};
export const savedVersionCount = (project: EditorProject) =>
  project.revisionCount ?? project.revisions.length;
