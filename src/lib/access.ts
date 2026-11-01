import { getAuth } from "./auth";
import {
  ensureWorkspace,
  projectInWorkspace,
  getJob,
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
    const workspace = ensureWorkspace(session.user.id, session.user.name),
      params = await context.params;
    let projectId: string | undefined;
    if (resource === "project") projectId = params.id;
    else if (resource === "job") projectId = getJob(params.id)?.projectId;
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
    return handler(req, context, { workspace, user: session.user });
  };
}
