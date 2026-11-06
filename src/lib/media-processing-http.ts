import {
  MAX_MEDIA_UPLOAD_BYTES,
  mediaUploadLimitText,
  mediaKinds,
} from "./timeline-limits";
import { randomUUID, createHash } from "node:crypto";
import { mediaUploadName } from "./media-upload-intent";
import { z, ZodError } from "zod";
import {
  mediaProcessing,
  mediaInputs,
  getProject,
  projectInWorkspace,
  mediaStorage,
  assertSharedMediaCapacity,
  assertUploadProjectCapacity,
  assertImportProjectCapacity,
} from "./db";
import {
  MEDIA_INPUT_BYTES,
  mediaProcessingPolicy,
  MediaProcessingCapacity,
  MediaProcessingConflict,
  MediaProcessingUnavailable,
  MediaAnalysisLimit,
  type MediaOperation,
} from "./media-processing-policy";
import type { MediaReceipt, MediaInput } from "./media-processing-store";
import {
  MediaStorageLimitError,
  sharedMediaStorageLimit,
} from "./media-storage-policy";
import { ProjectStorageLimit } from "./project-storage-policy";
import { LimitConfigurationError } from "./limits-policy";
import { multipart, readLimitedBody, RequestBodyError, failure } from "./http";

export const privateMediaHeaders = {
  "Cache-Control": "private, no-store",
  "X-Content-Type-Options": "nosniff",
};
export function reserveMediaRequest(
  req: Request,
  workspaceId: string,
  projectId: string | null,
  operation: MediaOperation,
  storageLimitBytes?: number,
) {
  const requestKey = z
    .uuid()
    .parse(req.headers.get("Idempotency-Key") ?? randomUUID());
  const fingerprint = req.headers.get("X-Reelchemy-Media-Intent") ?? undefined;
  if (fingerprint !== undefined)
    z.string()
      .regex(/^[a-f0-9]{64}$/)
      .parse(fingerprint);
  return mediaProcessing.reserve(
    {
      workspaceId,
      projectId,
      operation,
      requestKey,
      fingerprint,
      storageLimitBytes,
      sharedStorageLimitBytes:
        operation === "waveform" ? undefined : sharedMediaStorageLimit(),
    },
    operation === "upload"
      ? () => {
          assertUploadProjectCapacity(projectId!, workspaceId);
          assertSharedMediaCapacity();
        }
      : operation === "import"
        ? () => assertImportProjectCapacity(workspaceId)
        : undefined,
  );
}
function accepted(receipt: MediaReceipt, preferred = false) {
  return Response.json(
    { request: receipt },
    {
      status: 202,
      headers: {
        ...privateMediaHeaders,
        Location: `/api/media-requests/${receipt.id}`,
        ...(preferred ? { "Preference-Applied": "respond-async" } : {}),
        "Retry-After": "1",
      },
    },
  );
}
const errors = {
  INVALID_MEDIA:
    "This file could not be processed. Check its format, dimensions and duration, then try another file.",
  PROJECT_UNAVAILABLE:
    "The target project is no longer available for this operation.",
  STORAGE_LIMIT:
    "The processed media exceeds your studio's remaining allowance. Reduce its dimensions or duration, or contact the operator.",
  SERVICE_STORAGE_LIMIT:
    "Shared media storage is full. Keep your file and contact the studio operator, or retry after storage is available.",
  PROJECT_DATA_LIMIT:
    "The retained project allowance is full. Keep your file, manage saved history or remove an unneeded project, or contact the studio operator.",
  INTERRUPTED:
    "Media processing was interrupted twice. Keep your file and start a new request.",
  RECEIVE_TIMEOUT:
    "The upload did not finish in time. Keep your file and start a new request.",
  PROCESSING_TIMEOUT:
    "Media processing exceeded its time limit. Try a smaller or shorter file.",
  PROCESSING_FAILED:
    "Media processing could not finish. Keep your file and try again.",
};
export function mediaFailure(receipt: MediaReceipt) {
  if (receipt.error === "PROJECT_DATA_LIMIT")
    return Response.json(
      { error: errors.PROJECT_DATA_LIMIT, code: "PROJECT_STORAGE_LIMIT" },
      { status: 503, headers: privateMediaHeaders },
    );
  if (receipt.error === "SERVICE_STORAGE_LIMIT")
    return safeMediaFailure(new MediaStorageLimitError(0, 0, 1, "service"));
  if (receipt.error === "STORAGE_LIMIT" && receipt.storage)
    return safeMediaFailure(
      new MediaStorageLimitError(
        receipt.storage.usedBytes,
        receipt.storage.limitBytes,
        receipt.storage.requiredBytes,
      ),
    );
  return Response.json(
    {
      error:
        receipt.state === "cancelled"
          ? "Media processing was cancelled. Your file has not been added."
          : errors[receipt.error || "PROCESSING_FAILED"],
      code: receipt.state === "cancelled" ? "MEDIA_CANCELLED" : receipt.error,
    },
    {
      status:
        receipt.error === "PROJECT_UNAVAILABLE"
          ? 404
          : receipt.state === "cancelled"
            ? 409
            : receipt.error === "STORAGE_LIMIT"
              ? 413
              : 400,
      headers: privateMediaHeaders,
    },
  );
}
export async function mediaRequestResponse(
  req: Request,
  initial: MediaReceipt,
  workspaceId: string,
) {
  if (
    req.headers
      .get("Prefer")
      ?.split(",")
      .some((value) => value.trim().toLowerCase() === "respond-async")
  )
    return accepted(initial, true);
  // Existing clients retain their 201 response; official clients poll a durable
  // 202 receipt. Disconnecting never discards an accepted operation.
  const deadline = Date.now() + mediaProcessingPolicy().processingMs;
  let current = initial;
  while (Date.now() < deadline && !req.signal.aborted) {
    if (current.state === "completed") {
      const projectId =
        current.operation === "import" ? current.resultId : current.projectId;
      if (!projectId || !projectInWorkspace(projectId, workspaceId))
        return Response.json(
          { error: "Project not found." },
          { status: 404, headers: privateMediaHeaders },
        );
      return Response.json(getProject(projectId), {
        status: 201,
        headers: privateMediaHeaders,
      });
    }
    if (
      ["failed", "cancelled"].includes(current.state) &&
      !current.cleanupPending
    )
      return mediaFailure(current);
    await new Promise((resolve) => setTimeout(resolve, 100));
    const next = mediaProcessing.get(initial.id, workspaceId);
    if (!next)
      return Response.json(
        { error: "Media request not found." },
        { status: 404, headers: privateMediaHeaders },
      );
    current = next;
  }
  return accepted(current);
}
export function safeMediaFailure(error: unknown) {
  if (
    error instanceof ZodError ||
    error instanceof RequestBodyError ||
    error instanceof MediaProcessingCapacity ||
    error instanceof MediaAnalysisLimit ||
    error instanceof MediaProcessingConflict ||
    error instanceof MediaProcessingUnavailable ||
    error instanceof MediaStorageLimitError ||
    error instanceof ProjectStorageLimit ||
    error instanceof LimitConfigurationError
  ) {
    const response = failure(error);
    for (const [key, value] of Object.entries(privateMediaHeaders))
      response.headers.set(key, value);
    return response;
  }
  console.error(
    JSON.stringify({ event: "media.queue.failed", code: "QUEUE_UNAVAILABLE" }),
  );
  return Response.json(
    {
      error: "Media could not be queued. Keep your file and retry shortly.",
      code: "MEDIA_QUEUE_UNAVAILABLE",
    },
    { status: 503, headers: privateMediaHeaders },
  );
}
export async function receiveMediaRequest(
  req: Request,
  workspaceId: string,
  projectId: string | null,
  operation: "upload" | "import",
) {
  let reservation: ReturnType<typeof reserveMediaRequest> | undefined;
  let queued = false;
  try {
    const usage = mediaStorage(workspaceId);
    reservation = reserveMediaRequest(
      req,
      workspaceId,
      projectId,
      operation,
      usage.limitBytes,
    );
    if (!reservation.created)
      return await mediaRequestResponse(req, reservation.receipt, workspaceId);
    if (
      operation === "upload" &&
      (getProject(projectId!)?.assets?.length || 0) >= 30
    )
      throw new RequestBodyError("Project limit is 30 assets.");
    if (operation === "upload" && usage.remainingBytes === 0)
      throw new MediaStorageLimitError(usage.usedBytes, usage.limitBytes, 1);
    const options = {
      timeoutMs: mediaProcessingPolicy().receiveMs,
      cancelled: () =>
        mediaProcessing.get(reservation!.receipt.id, workspaceId)?.state !==
        "receiving",
    };
    let bytes: Uint8Array, metadata: MediaInput;
    if (operation === "upload") {
      const form = await multipart(req, MEDIA_INPUT_BYTES.upload, options);
      const kind = z.enum(mediaKinds).parse(form.get("kind") || "image");
      const file = form.get("file");
      if (!(file instanceof File))
        throw new RequestBodyError("Select a media file.");
      if (!file.size || file.size > MAX_MEDIA_UPLOAD_BYTES[kind])
        throw new RequestBodyError(
          `${{ image: "Images", audio: "Audio files", video: "Videos", font: "Fonts" }[kind]} must be ${mediaUploadLimitText(kind)} or smaller.`,
        );
      const license = z
        .string()
        .trim()
        .min(3)
        .max(500)
        .parse(form.get("license"));
      bytes = new Uint8Array(await file.arrayBuffer());
      metadata = {
        operation,
        name: mediaUploadName(file.name, kind),
        kind,
        license,
        bytes: bytes.length,
        sha256: createHash("sha256").update(bytes).digest("hex"),
      };
    } else {
      bytes = await readLimitedBody(req, MEDIA_INPUT_BYTES.import, options);
      metadata = {
        operation,
        bytes: bytes.length,
        sha256: createHash("sha256").update(bytes).digest("hex"),
      };
    }
    if (req.signal.aborted)
      throw new RequestBodyError(
        "Upload interrupted. Keep your file and retry.",
        408,
      );
    const receipt = mediaProcessing.enqueue(
      reservation.receipt.id,
      reservation.token,
      metadata,
      () =>
        mediaInputs.write(
          reservation!.receipt.id,
          bytes,
          MEDIA_INPUT_BYTES[operation],
          metadata.sha256,
        ),
    );
    queued = true;
    return await mediaRequestResponse(req, receipt, workspaceId);
  } catch (error) {
    const response =
      projectId && !projectInWorkspace(projectId, workspaceId)
        ? Response.json(
            { error: "Project not found." },
            { status: 404, headers: privateMediaHeaders },
          )
        : safeMediaFailure(error);
    if (reservation?.created && !queued)
      response.headers.set("X-Reelchemy-Media-Not-Queued", "1");
    return response;
  } finally {
    if (reservation?.created && !queued) {
      if (req.signal.aborted)
        mediaProcessing.cancel(reservation.receipt.id, workspaceId);
      mediaProcessing.abandonReceiver(
        reservation.receipt.id,
        reservation.token,
      );
    }
  }
}
