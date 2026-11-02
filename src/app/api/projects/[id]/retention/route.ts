import { secureRoute, type Access } from "@/lib/access";
import {
  ownedProjectDataUsage,
  ownedProjectRetention,
  cleanOwnedProjectHistory,
} from "@/lib/db";
import { body, failure, RequestBodyError } from "@/lib/http";
import {
  retentionSelection,
  ProjectRetentionConflict,
  ProjectRetentionUnavailable,
} from "@/lib/project-retention";
import { privateProjectHeaders } from "@/lib/project-http";
import { z } from "zod";
type Context = { params: Promise<{ id: string }> };
const missing = () =>
  Response.json({ error: "Project not found." }, { status: 404 });
function retentionFailure(error: unknown) {
  if (error instanceof SyntaxError)
    return Response.json(
      { error: "Choose a valid history cleanup request." },
      { status: 400 },
    );
  if (error instanceof ProjectRetentionConflict)
    return Response.json(
      { error: error.message, code: "HISTORY_CLEANUP_CONFLICT" },
      { status: 409 },
    );
  if (error instanceof ProjectRetentionUnavailable)
    return Response.json(
      { error: error.message, code: "HISTORY_CLEANUP_UNAVAILABLE" },
      { status: 422 },
    );
  if (error instanceof z.ZodError || error instanceof RequestBodyError)
    return failure(error);
  console.error("PROJECT_RETENTION_UNAVAILABLE");
  return Response.json(
    {
      error:
        "Saved history management is temporarily unavailable. Your edits are kept here.",
    },
    { status: 503 },
  );
}
const read = secureRoute(
  async (req: Request, context: Context, access: Access) => {
    try {
      const id = (await context.params).id,
        query = new URL(req.url).searchParams;
      if (query.get("preview") === "1") {
        const raw = (name: string) => {
          const value = query.get(name);
          if (!value || !/^[1-9]\d{0,4}$/.test(value))
            throw new RequestBodyError(
              "Choose how much saved history to keep.",
            );
          return Number(value);
        };
        const selection = retentionSelection.parse({
          keepVersions: raw("keepVersions"),
          keepMessages: raw("keepMessages"),
        });
        const plan = ownedProjectRetention(id, access.workspace.id, selection);
        return plan ? Response.json(plan) : missing();
      }
      if ([...query.keys()].length)
        throw new RequestBodyError("Choose a valid history request.");
      const result = ownedProjectDataUsage(id, access.workspace.id);
      return result ? Response.json(result) : missing();
    } catch (error) {
      return retentionFailure(error);
    }
  },
  "project",
);
const clean = secureRoute(
  async (req: Request, context: Context, access: Access) => {
    try {
      const payload = retentionSelection
        .extend({
          digest: z.string().regex(/^[a-f0-9]{64}$/),
          requestId: z.string().regex(/^[a-zA-Z0-9_-]{16,80}$/),
          confirmation: z.literal("REMOVE EARLIER HISTORY"),
        })
        .strict()
        .parse(await body(req));
      const result = cleanOwnedProjectHistory(
        (await context.params).id,
        access.workspace.id,
        payload,
        payload.digest,
        payload.requestId,
      );
      return result ? Response.json(result) : missing();
    } catch (error) {
      return retentionFailure(error);
    }
  },
  "project",
);
async function privateResponse(result: Promise<Response>) {
  const response = await result;
  for (const [name, value] of Object.entries(privateProjectHeaders))
    response.headers.set(name, value);
  return response;
}
export const GET = (req: Request, context: Context) =>
  privateResponse(read(req, context));
export const POST = (req: Request, context: Context) =>
  privateResponse(clean(req, context));
