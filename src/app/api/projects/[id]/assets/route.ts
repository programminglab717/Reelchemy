import { secureRoute } from "@/lib/access";
import { z } from "zod";
import { getProject, saveProject } from "@/lib/db";
import { storeAudio } from "@/lib/audio";
import { storeImage, assetDir } from "@/lib/assets";
import { storeVideo } from "@/lib/video";
import { unlink } from "node:fs/promises";
import path from "node:path";
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
    if (Number(req.headers.get("content-length") || 0) > 26 * 1024 * 1024)
      throw new Error("Upload too large.");
    const form = await multipart(req, 26 * 1024 * 1024);
    const kind = z
      .enum(["image", "audio", "video"])
      .parse(form.get("kind") || "image");
    const file = form.get("file");
    if (!(file instanceof File)) throw new Error("Select a media file.");
    if (file.size > (kind === "video" ? 25 : 10) * 1024 * 1024)
      throw new Error(
        kind === "video"
          ? "Videos must be 25 MB or smaller."
          : "Image and audio files must be 10 MB or smaller.",
      );
    const license = z
      .string()
      .trim()
      .min(3)
      .max(500)
      .parse(form.get("license"));
    const asset = await (
      kind === "video" ? storeVideo : kind === "audio" ? storeAudio : storeImage
    )(Buffer.from(await file.arrayBuffer()), file.name, license);
    const latest = getProject(id)!;
    if ((latest.assets || []).length >= 30) {
      await unlink(path.join(assetDir, asset.id));
      throw new Error("Project limit is 30 assets.");
    }
    latest.assets = [...(latest.assets || []), asset];
    return Response.json(saveProject(latest), { status: 201 });
  } catch (e) {
    return failure(e);
  }
}

export const POST = secureRoute(POSTHandler, "project", { rate: "media" });
