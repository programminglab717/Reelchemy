import { getAuth } from "./auth";
import {
  ensureWorkspace,
  projectInWorkspace,
  getJob,
  type Workspace,
} from "./db";
export type Access = {
  workspace: Workspace;
  user: { id: string; name: string; email: string };
};
type Params = Record<string, string>;
export function secureRoute<P extends Params>(
  handler: (
    req: Request,
    context: { params: Promise<P> },
    access: Access,
  ) => Response | Promise<Response>,
  resource: "user" | "project" | "job",
) {
  return async (req: Request, context: { params: Promise<P> }) => {
    let session;
    try {
      session = await (
        await getAuth()
      ).api.getSession({ headers: req.headers });
    } catch {
      return Response.json(
        { error: "Authentication service unavailable." },
        { status: 503 },
      );
    }
    if (!session?.user || !session.user.emailVerified)
      return Response.json(
        { error: "Sign in with a verified account to continue." },
        { status: 401 },
      );
    const workspace = ensureWorkspace(session.user.id, session.user.name),
      params = await context.params;
    let projectId: string | undefined;
    if (resource === "project") projectId = params.id;
    else if (resource === "job") projectId = getJob(params.id)?.projectId;
    if (
      resource !== "user" &&
      (!projectId || !projectInWorkspace(projectId, workspace.id))
    )
      return Response.json({ error: "Resource not found." }, { status: 404 });
    return handler(req, context, { workspace, user: session.user });
  };
}
