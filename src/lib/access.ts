import { getAuth } from "./auth";
import {
  ensureWorkspace,
  projectInWorkspace,
  jobProjectId,
  takeRequestLimit,
  type Workspace,
} from "./db";
import { localMutation, failure } from "./http";
import { accountMismatch } from "./account-session";
import {
  limitsPolicy,
  RequestRateError,
  type LimitedOperation,
} from "./limits-policy";
export type Access = {
  workspace: Workspace;
  user: { id: string; name: string; email: string };
};
type Params = Record<string, string>;
// Requests made inside the server on behalf of an already authenticated
// caller (the MCP endpoint, for a personal access token). Only server code
// can register a request here, so outside requests always need a session.
const internal = new WeakMap<Request, Access>();
export function internalRequest(request: Request, access: Access) {
  internal.set(request, access);
  return request;
}
export function secureRoute<P extends Params>(
  handler: (
    req: Request,
    context: { params: Promise<P> },
    access: Access,
  ) => Response | Promise<Response>,
  resource: "user" | "project" | "job",
  options: {
    includeTrashed?: boolean;
    rate?: Exclude<LimitedOperation, "writes">;
  } = {},
) {
  return async (req: Request, context: { params: Promise<P> }) => {
    const granted = internal.get(req);
    let workspace: Workspace, user: Access["user"];
    if (granted) ({ workspace, user } = granted);
    else {
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
      const mismatch = accountMismatch(req.headers, session.user.id);
      if (mismatch) return mismatch;
      workspace = ensureWorkspace(session.user.id, session.user.name);
      user = session.user;
    }
    const params = await context.params;
    let projectId: string | undefined;
    if (resource === "project") projectId = params.id;
    else if (resource === "job") projectId = jobProjectId(params.id);
    if (
      resource !== "user" &&
      (!projectId ||
        !projectInWorkspace(projectId, workspace.id, options.includeTrashed))
    )
      return Response.json({ error: "Resource not found." }, { status: 404 });
    if (["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) {
      try {
        // Ownership and origin checks precede quota consumption. Requests that
        // fail validation still count; this is abuse control, not paid usage.
        localMutation(req);
        const policy = limitsPolicy();
        for (const operation of [
          "writes",
          ...(options.rate ? [options.rate] : []),
        ] as LimitedOperation[]) {
          const limit = policy[operation];
          const result = takeRequestLimit(
            workspace.id,
            operation,
            limit.count,
            limit.windowMs,
          );
          if (!result.allowed)
            throw new RequestRateError(result.retryAfter, operation);
        }
      } catch (e) {
        return failure(e);
      }
    }
    return handler(req, context, { workspace, user });
  };
}
