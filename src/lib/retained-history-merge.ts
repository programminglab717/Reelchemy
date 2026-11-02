import type { EditorProject } from "./project-view";
import { revisionId } from "./editor";
// Refresh retained metadata without opening a project, changing its saved CAS
// base, replacing a newer local film, or clearing undo/recovery state.
export function mergeRetainedHistory(
  current: EditorProject,
  incoming: EditorProject,
  expectedRevisionId: string | null,
): EditorProject | null {
  if (
    current.id !== incoming.id ||
    revisionId(current) !== expectedRevisionId ||
    revisionId(incoming) !== expectedRevisionId
  )
    return null;
  return {
    ...current,
    revisions: incoming.revisions,
    revisionCount: incoming.revisionCount,
    messages: incoming.messages,
    messageCount: incoming.messageCount,
    messageStart: incoming.messageStart,
    messageUnavailable: incoming.messageUnavailable,
  };
}
