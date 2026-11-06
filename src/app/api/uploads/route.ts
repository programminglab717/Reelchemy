import { secureRoute, type Access } from "@/lib/access";
import {
  assertImportProjectCapacity,
  assertSharedMediaCapacity,
  assertUploadProjectCapacity,
  mediaStorage,
  projectInWorkspace,
  uploadSessions,
} from "@/lib/db";
import { body, RequestBodyError } from "@/lib/http";
import {
  privateMediaHeaders,
  safeMediaFailure,
} from "@/lib/media-processing-http";
import { MediaStorageLimitError } from "@/lib/media-storage-policy";
import { mediaUploadName } from "@/lib/media-upload-intent";
import { UPLOAD_CHUNK_BYTES } from "@/lib/timeline-limits";
import { uploadSessionInput } from "@/lib/upload-sessions";

// Starts a resumable upload for a file larger than one request should carry.
// The finished file is handed to the ordinary media endpoint with
// X-Reelchemy-Upload-Session.
async function POSTHandler(req: Request, _ctx: unknown, access: Access) {
  try {
    const raw = await body(req, 4096);
    const input = uploadSessionInput.parse(
      raw?.operation === "upload"
        ? { ...raw, name: mediaUploadName(String(raw.name ?? ""), raw.kind) }
        : raw,
    );
    const workspaceId = access.workspace.id;
    if (
      input.operation === "upload" &&
      !projectInWorkspace(input.projectId, workspaceId)
    )
      return Response.json(
        { error: "Project not found." },
        { status: 404, headers: privateMediaHeaders },
      );
    if (input.operation === "upload") {
      const usage = mediaStorage(workspaceId);
      if (usage.remainingBytes === 0)
        throw new MediaStorageLimitError(usage.usedBytes, usage.limitBytes, 1);
    }
    const session = uploadSessions.create(workspaceId, input, () => {
      if (input.operation === "upload") {
        assertUploadProjectCapacity(input.projectId, workspaceId);
        assertSharedMediaCapacity();
      } else assertImportProjectCapacity(workspaceId);
    });
    return Response.json(
      {
        id: session.id,
        bytes: session.bytes,
        received: session.received,
        chunkBytes: UPLOAD_CHUNK_BYTES,
      },
      { status: 201, headers: privateMediaHeaders },
    );
  } catch (error) {
    if (error instanceof SyntaxError)
      return safeMediaFailure(new RequestBodyError("Invalid upload request."));
    return safeMediaFailure(error);
  }
}
export const POST = secureRoute(POSTHandler, "user");
