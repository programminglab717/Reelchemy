import { secureRoute, type Access } from "@/lib/access";
import { z } from "zod";
import { getProject, appendOwnedAsset, mediaStorage } from "@/lib/db";
import type { Asset } from "@/lib/schema";
import { MediaStorageLimitError } from "@/lib/media-storage-policy";
import { storeAudio } from "@/lib/audio";
import { storeImage, assetDir } from "@/lib/assets";
import { storeVideo } from "@/lib/video";
import { unlink } from "node:fs/promises";
import path from "node:path";
import { failure, localMutation, multipart } from "@/lib/http";
async function POSTHandler(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
  access: Access,
) {
  let asset: Asset | undefined,
    committed = false;
  try {
    localMutation(req);
    const { id } = await params;
    const project = getProject(id);
    if (!project)
      return Response.json({ error: "Project not found" }, { status: 404 });
    if ((project.assets || []).length >= 30)
      throw new Error("Project limit is 30 assets.");
    const usage = mediaStorage(access.workspace.id);
    if (usage.remainingBytes === 0)
      throw new MediaStorageLimitError(usage.usedBytes, usage.limitBytes, 1);
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
    asset = await (
      kind === "video" ? storeVideo : kind === "audio" ? storeAudio : storeImage
    )(Buffer.from(await file.arrayBuffer()), file.name, license);
    const saved = appendOwnedAsset(id, access.workspace.id, asset);
    if (!saved)
      return Response.json({ error: "Project not found" }, { status: 404 });
    committed = true;
    return Response.json(saved, { status: 201 });
  } catch (e) {
    return failure(e);
  } finally {
    if (asset && !committed) {
      try {
        await unlink(path.join(assetDir, asset.id));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT")
          console.error(
            JSON.stringify({
              event: "media.cleanup-failed",
              code: (error as NodeJS.ErrnoException).code || "UNKNOWN",
            }),
          );
      }
    }
  }
}

export const POST = secureRoute(POSTHandler, "project", { rate: "media" });
