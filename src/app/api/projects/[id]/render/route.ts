import { secureRoute } from "@/lib/access";
import { validateProjectAssets } from "@/lib/assets";
import { createJob, getProject, listJobs } from "@/lib/db";
import { inspectTimeline } from "@/lib/qc";
import { failure, localMutation } from "@/lib/http";
async function POSTHandler(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    localMutation(req);
    const p = getProject((await params).id);
    if (!p)
      return Response.json({ error: "Project not found" }, { status: 404 });
    if (!p.timeline)
      throw new Error("Generate and approve a storyboard first.");
    validateProjectAssets(p, p.timeline);
    const blocking = inspectTimeline(
      p.timeline,
      (p.assets || []).map((a) => a.id),
    ).filter((i) => i.severity === "error" && i.code !== "bounds");
    if (blocking.length)
      throw new Error(blocking.map((i) => i.message).join(" "));
    return Response.json(createJob(p), { status: 202 });
  } catch (e) {
    return failure(e);
  }
}

async function GETHandler(
  _: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!getProject(id))
    return Response.json({ error: "Project not found" }, { status: 404 });
  return Response.json(listJobs(id));
}

export const POST = secureRoute(POSTHandler, "project", { rate: "render" });
export const GET = secureRoute(GETHandler, "project");
