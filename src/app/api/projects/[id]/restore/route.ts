import { secureRoute } from "@/lib/access";
import {
  revisionId as currentRevisionId,
  RevisionConflict,
} from "@/lib/editor";
import { z } from "zod";
import { getProject, reviseProject } from "@/lib/db";
import { timelineSchema } from "@/lib/schema";
import { body, failure, localMutation } from "@/lib/http";
async function POSTHandler(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    localMutation(req);
    const { revisionId, baseRevisionId } = z
      .object({
        revisionId: z.string().max(80),
        baseRevisionId: z.string().min(1).max(80).nullable(),
      })
      .parse(await body(req));
    const p = getProject((await params).id);
    if (!p)
      return Response.json({ error: "Project not found" }, { status: 404 });
    if (currentRevisionId(p) !== baseRevisionId) throw new RevisionConflict();
    const r = p.revisions.find((r) => r.id === revisionId);
    if (!r) throw new Error("Revision not found.");
    return Response.json(
      reviseProject(p, timelineSchema.parse(r.timeline), `Restored ${r.id}`),
    );
  } catch (e) {
    return failure(e);
  }
}

export const POST = secureRoute(POSTHandler, "project");
