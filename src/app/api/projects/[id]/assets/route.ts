import { secureRoute } from "@/lib/access";
import { z } from "zod";
import { getProject, saveProject } from "@/lib/db";
import { storeAudio } from "@/lib/audio";
import { storeImage } from "@/lib/assets";
import { failure, localMutation, multipart } from "@/lib/http";
async function POSTHandler(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    localMutation(req);
    const { id } = await params;
    const project = getProject(id);
    if (!project)
      return Response.json({ error: "Project not found" }, { status: 404 });
    if ((project.assets || []).length >= 30)
      throw new Error("Project limit is 30 assets.");
    if (Number(req.headers.get("content-length") || 0) > 11 * 1024 * 1024)
      throw new Error("Upload too large.");
    const form = await multipart(req);
    const file = form.get("file");
    if (!(file instanceof File)) throw new Error("Select an image file.");
    if (file.size > 10 * 1024 * 1024)
      throw new Error("Images must be 10 MB or smaller.");
    const license = z
      .string()
      .trim()
      .min(3)
      .max(500)
      .parse(form.get("license"));
    const asset = await (
      form.get("kind") === "audio" ? storeAudio : storeImage
    )(Buffer.from(await file.arrayBuffer()), file.name, license);
    const latest = getProject(id)!;
    latest.assets = [...(latest.assets || []), asset];
    return Response.json(saveProject(latest), { status: 201 });
  } catch (e) {
    return failure(e);
  }
}

export const POST = secureRoute(POSTHandler, "project");
