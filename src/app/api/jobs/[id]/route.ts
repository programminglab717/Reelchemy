import { secureRoute } from "@/lib/access";
import { getJob, updateJob } from "@/lib/db";
import { failure, localMutation } from "@/lib/http";
type Context = { params: Promise<{ id: string }> };
async function GETHandler(_: Request, { params }: Context) {
  const job = getJob((await params).id);
  return job
    ? Response.json(job)
    : Response.json({ error: "Job not found" }, { status: 404 });
}
async function DELETEHandler(req: Request, { params }: Context) {
  try {
    localMutation(req);
    const job = getJob((await params).id);
    if (!job) return Response.json({ error: "Job not found" }, { status: 404 });
    if (job.status !== "queued" && job.status !== "rendering")
      throw new Error("Only active renders can be cancelled.");
    return Response.json(
      updateJob(job.id, {
        status: "cancelled",
        stage: "Cancelled",
        events: [
          ...(job.events || []),
          {
            at: new Date().toISOString(),
            stage: "Cancelled",
            message: "Export cancelled by user.",
          },
        ].slice(-100),
      }),
    );
  } catch (e) {
    return failure(e);
  }
}

export const GET = secureRoute(GETHandler, "job");
export const DELETE = secureRoute(DELETEHandler, "job");
