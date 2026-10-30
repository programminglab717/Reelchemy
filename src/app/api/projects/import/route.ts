import { secureRoute, type Access } from "@/lib/access";
import { saveImportedProject } from "@/lib/db";
import { importArchive } from "@/lib/archive";
import { assetDir } from "@/lib/assets";
import type { Project } from "@/lib/schema";
import { unlink } from "node:fs/promises";
import path from "node:path";
import { mediaStorageLimit } from "@/lib/media-storage-policy";
import { localMutation, readLimitedBody, failure } from "@/lib/http";
async function POSTHandler(req: Request, _ctx: unknown, access: Access) {
  let imported: Project | undefined,
    committed = false;
  try {
    localMutation(req);
    mediaStorageLimit();
    imported = await importArchive(
      await readLimitedBody(req, 50 * 1024 * 1024),
    );
    const saved = saveImportedProject(imported, access.workspace.id);
    committed = true;
    return Response.json(saved, { status: 201 });
  } catch (e) {
    return failure(e);
  } finally {
    if (imported && !committed)
      await Promise.all(
        (imported.assets || []).map(async (asset) => {
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
        }),
      );
  }
}

export const POST = secureRoute(POSTHandler, "user", { rate: "media" });
