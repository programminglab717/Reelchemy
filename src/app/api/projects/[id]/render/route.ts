import { createJob, getProject } from "@/lib/db";
import { inspectTimeline } from "@/lib/qc";
import { failure, localMutation } from "@/lib/http";
export async function POST(
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
    const blocking = inspectTimeline(p.timeline).filter(
      (i) => i.severity === "error" && i.code !== "bounds",
    );
    if (blocking.length)
      throw new Error(blocking.map((i) => i.message).join(" "));
    return Response.json(createJob(p), { status: 202 });
  } catch (e) {
    return failure(e);
  }
}
