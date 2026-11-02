import { revisionId, RevisionConflict } from "./editor";
import { editorProject } from "./db";
import type { Project } from "./schema";
import { PROJECT_VIEW_HEADER, EDITOR_PROJECT_VIEW } from "./project-view";
export const privateProjectHeaders = {
  "Cache-Control": "private, no-store",
  "X-Content-Type-Options": "nosniff",
};
export const wantsEditorProject = (request: Request) =>
  request.headers.get(PROJECT_VIEW_HEADER) === EDITOR_PROJECT_VIEW;
export function editorProjectResponse(
  projectId: string,
  workspaceId: string,
  status = 200,
  expectedRevision?: string | null,
) {
  try {
    const project = editorProject(projectId, workspaceId);
    if (
      project &&
      expectedRevision !== undefined &&
      revisionId(project) !== expectedRevision
    )
      return Response.json(
        { error: new RevisionConflict().message, code: "REVISION_CONFLICT" },
        { status: 409, headers: privateProjectHeaders },
      );
    return project
      ? Response.json(project, { status, headers: privateProjectHeaders })
      : Response.json(
          { error: "Project not found." },
          { status: 404, headers: privateProjectHeaders },
        );
  } catch {
    return Response.json(
      {
        error:
          "This saved project could not be loaded. Keep your current edits and retry when ready.",
      },
      { status: 503, headers: privateProjectHeaders },
    );
  }
}
export function projectResponse(
  request: Request,
  project: Project,
  workspaceId: string,
  status = 200,
) {
  return wantsEditorProject(request)
    ? editorProjectResponse(
        project.id,
        workspaceId,
        status,
        revisionId(project),
      )
    : Response.json(project, { status, headers: privateProjectHeaders });
}
