import { secureRoute, type Access } from "@/lib/access";
import { uploadSessions } from "@/lib/db";
import { readLimitedBody, RequestBodyError } from "@/lib/http";
import {
  privateMediaHeaders,
  safeMediaFailure,
} from "@/lib/media-processing-http";
import { UPLOAD_CHUNK_BYTES } from "@/lib/timeline-limits";
import { UploadOffsetConflict } from "@/lib/upload-sessions";
import { z } from "zod";

type Context = { params: Promise<{ id: string }> };
const gone = () =>
  Response.json(
    {
      error:
        "This upload is no longer available. Choose the file again to restart it.",
    },
    { status: 404, headers: privateMediaHeaders },
  );
const progress = (session: {
  bytes: number;
  received: number;
  state: string;
}) =>
  Response.json(
    {
      bytes: session.bytes,
      received: session.received,
      complete: session.state === "complete",
    },
    { headers: privateMediaHeaders },
  );
async function sessionId(context: Context) {
  return z.uuid().safeParse((await context.params).id).data;
}

async function GETHandler(_req: Request, context: Context, access: Access) {
  const id = await sessionId(context);
  const session = id && uploadSessions.status(id, access.workspace.id);
  return session ? progress(session) : gone();
}
// One piece: Upload-Offset says where it starts; X-Reelchemy-Chunk-SHA256
// lets the server refuse a piece damaged in transit.
async function PUTHandler(req: Request, context: Context, access: Access) {
  const id = await sessionId(context);
  if (!id) return gone();
  try {
    const offset = Number(req.headers.get("Upload-Offset"));
    const sha256 = req.headers.get("X-Reelchemy-Chunk-SHA256") || "";
    if (
      !Number.isSafeInteger(offset) ||
      offset < 0 ||
      !/^[a-f0-9]{64}$/.test(sha256)
    )
      throw new RequestBodyError("Invalid upload piece.");
    const chunk = await readLimitedBody(req, UPLOAD_CHUNK_BYTES, {
      timeoutMs: 300000,
    });
    return progress(
      await uploadSessions.append(
        id,
        access.workspace.id,
        offset,
        chunk,
        sha256,
      ),
    );
  } catch (error) {
    if (error instanceof UploadOffsetConflict)
      return Response.json(
        { error: error.message, received: error.received },
        { status: 409, headers: privateMediaHeaders },
      );
    return safeMediaFailure(error);
  }
}
async function DELETEHandler(_req: Request, context: Context, access: Access) {
  const id = await sessionId(context);
  if (id) uploadSessions.remove(id, access.workspace.id);
  return new Response(null, { status: 204, headers: privateMediaHeaders });
}
export const GET = secureRoute(GETHandler, "user");
export const PUT = secureRoute(PUTHandler, "user");
export const DELETE = secureRoute(DELETEHandler, "user");
