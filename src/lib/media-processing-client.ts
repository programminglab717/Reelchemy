import {
  MAX_MEDIA_UPLOAD_BYTES,
  MAX_ARCHIVE_BYTES,
  UPLOAD_CHUNK_BYTES,
  byteLimitText,
  mediaUploadLimitText,
  mediaKinds,
  type MediaKind,
} from "./timeline-limits";
import type { AccountFetch } from "./account-fetch";
import type { MediaInput, MediaReceipt } from "./media-processing-store";
import type { Project } from "./schema";
import type { AssetUpdate } from "./project-assets";
import { clientWait } from "./client-wait";
import { mediaUploadName, MEDIA_PROCESSING_EVENT } from "./media-upload-intent";

export type MediaSubmission = {
  endpoint: string;
  fingerprint: string;
  key: string;
  requestId?: string;
  // A large file sent in pieces: its resumable upload on the server.
  uploadId?: string;
};
export type MediaSubmissionRef = { current: MediaSubmission | null };
export class MediaStillProcessing extends Error {
  constructor() {
    super(
      "Media processing is still in progress. Keep this file, then check Media processing or retry to recover the same request.",
    );
  }
}
async function digest(bytes: Uint8Array) {
  const hash = await crypto.subtle.digest("SHA-256", new Uint8Array(bytes));
  return [...new Uint8Array(hash)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}
// Files above one upload chunk are sent in resumable pieces and are never read
// whole into memory; the server computes their content hash. Locally they are
// identified by name, size, modification time and their first and last bytes.
const staged = (file: Blob) => file.size > UPLOAD_CHUNK_BYTES;
async function contentDigest(file: File) {
  if (!staged(file)) return digest(new Uint8Array(await file.arrayBuffer()));
  const edge = 1024 * 1024;
  const head = new Uint8Array(await file.slice(0, edge).arrayBuffer()),
    tail = new Uint8Array(await file.slice(file.size - edge).arrayBuffer());
  return digest(
    new Uint8Array([
      ...new TextEncoder().encode(
        `staged-v1\n${file.name}\n${file.size}\n${file.lastModified}\n`,
      ),
      ...head,
      ...tail,
    ]),
  );
}
async function intent(body: FormData | File): Promise<MediaInput> {
  if (body instanceof FormData) {
    const kind = body.get("kind") || "image",
      file = body.get("file");
    if (
      !(mediaKinds as readonly string[]).includes(String(kind)) ||
      !(file instanceof File)
    )
      throw new Error("Choose an image, audio, video or font file.");
    const license = String(body.get("license") || "")
      .replace(/\r\n?|\n/g, "\r\n")
      .trim();
    if (license.length < 3 || license.length > 500)
      throw new Error(
        "Describe your source or usage rights in 3–500 characters.",
      );
    const mediaKind = kind as MediaKind;
    if (!file.size || file.size > MAX_MEDIA_UPLOAD_BYTES[mediaKind])
      throw new Error(
        `Choose ${mediaKind === "image" ? "an image" : `a ${mediaKind} file`} up to ${mediaUploadLimitText(mediaKind)}.`,
      );
    return {
      operation: "upload",
      name: mediaUploadName(file.name, mediaKind),
      kind: mediaKind,
      license,
      bytes: file.size,
      sha256: await contentDigest(file),
    };
  }
  if (!body.size || body.size > MAX_ARCHIVE_BYTES)
    throw new Error(
      `Choose a project archive up to ${byteLimitText(MAX_ARCHIVE_BYTES)}.`,
    );
  return {
    operation: "import",
    bytes: body.size,
    sha256: await contentDigest(body),
  };
}
const uuid =
  /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
function receipt(value: unknown): MediaReceipt {
  const result = value as Partial<MediaReceipt> | null;
  if (
    !result ||
    typeof result.id !== "string" ||
    !uuid.test(result.id) ||
    ![
      "receiving",
      "queued",
      "working",
      "cancelling",
      "completed",
      "failed",
      "cancelled",
    ].includes(String(result.state))
  )
    throw new Error(
      "The processing response was incomplete. Keep your file and retry to recover the request.",
    );
  return result as MediaReceipt;
}
function notify() {
  if (typeof window !== "undefined")
    window.dispatchEvent(new Event(MEDIA_PROCESSING_EVENT));
}
function failureMessage(result: MediaReceipt) {
  if (result.state === "cancelled")
    return "Media processing was cancelled. The file has not been added; you can try again.";
  if (result.error === "STORAGE_LIMIT")
    return "The processed media exceeds your studio's remaining allowance. Reduce its dimensions or duration, or contact the operator.";
  if (result.error === "SERVICE_STORAGE_LIMIT")
    return "Shared media storage is full. Your file is kept here. Contact the studio operator or retry after storage is available.";
  if (result.error === "PROJECT_DATA_LIMIT")
    return "The retained project allowance is full. Keep your file and use Manage saved history, remove an unneeded project, or contact the operator before retrying.";
  if (result.error === "PROJECT_UNAVAILABLE")
    return "The target project is no longer available. Keep your file and open an active project.";
  if (result.error === "PROCESSING_TIMEOUT")
    return "Preparing this file took too long. Try a smaller or shorter file.";
  if (result.error === "INTERRUPTED")
    return "Media processing was interrupted twice. Keep your file and retry with a new request.";
  return "This file could not be processed. Check its format, dimensions and duration, then retry or choose another file.";
}
class UploadStopped extends Error {}
// Sends `file` in pieces to its resumable upload, continuing from what the
// server already has. Each piece carries its SHA-256 so a damaged piece is
// refused and sent again.
async function sendStaged(
  transport: AccountFetch,
  endpoint: string,
  file: File,
  metadata: MediaInput,
  current: MediaSubmission,
  signal: AbortSignal,
  progress: (message: string) => void,
) {
  let received = 0;
  if (current.uploadId) {
    const response = await transport(`/api/uploads/${current.uploadId}`, {
      cache: "no-store",
      signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]),
    });
    const payload = await response.json();
    if (response.ok) received = Number(payload.received) || 0;
    else if (response.status === 404) current.uploadId = undefined;
    else
      throw new Error(
        payload.error ||
          "Could not check the upload. Keep your file and retry.",
      );
  }
  if (!current.uploadId) {
    const projectId =
      metadata.operation === "upload"
        ? decodeURIComponent(endpoint.split("/")[3] || "")
        : undefined;
    const response = await transport("/api/uploads", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        metadata.operation === "upload"
          ? {
              operation: "upload",
              projectId,
              kind: metadata.kind,
              name: metadata.name,
              license: metadata.license,
              bytes: metadata.bytes,
            }
          : { operation: "import", bytes: file.size },
      ),
      signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]),
    });
    const payload = await response.json();
    if (!response.ok)
      throw new Error(
        payload.error ||
          "The upload could not start. Keep your file and retry.",
      );
    current.uploadId = String(payload.id);
    received = 0;
  }
  while (received < file.size) {
    signal.throwIfAborted();
    progress(`Uploading file… ${Math.floor((received / file.size) * 100)}%`);
    const offset = received;
    const piece = new Uint8Array(
      await file
        .slice(offset, Math.min(file.size, offset + UPLOAD_CHUNK_BYTES))
        .arrayBuffer(),
    );
    const checksum = await digest(piece);
    for (let attempt = 1; ; attempt++) {
      try {
        const response = await transport(`/api/uploads/${current.uploadId}`, {
          method: "PUT",
          body: piece,
          headers: {
            "Content-Type": "application/octet-stream",
            "Upload-Offset": String(offset),
            "X-Reelchemy-Chunk-SHA256": checksum,
          },
          signal: AbortSignal.any([signal, AbortSignal.timeout(300000)]),
        });
        const payload = await response.json().catch(() => ({}));
        if (
          response.ok ||
          (response.status === 409 && typeof payload.received === "number")
        ) {
          received = Number(payload.received);
          break;
        }
        if (response.status === 404) {
          current.uploadId = undefined;
          throw new UploadStopped(
            payload.error ||
              "This upload is no longer available. Retry to send the file again.",
          );
        }
        if (response.status < 500 && ![408, 422, 429].includes(response.status))
          throw new UploadStopped(
            payload.error ||
              "The upload was refused. Keep your file and retry.",
          );
        throw new Error("Retry this piece.");
      } catch (error) {
        if (signal.aborted || error instanceof UploadStopped) throw error;
        if (attempt >= 5)
          throw new Error(
            "The upload was interrupted. Retry to continue from where it stopped.",
          );
        await clientWait(1000 * 2 ** attempt, signal);
      }
    }
  }
  progress("Uploading file… 100%");
}
export function submitMedia(
  transport: AccountFetch,
  endpoint: string,
  body: FormData,
  submission: MediaSubmissionRef,
  signal: AbortSignal,
  progress?: (message: string) => void,
  timeoutMs?: number,
): Promise<AssetUpdate>;
export function submitMedia(
  transport: AccountFetch,
  endpoint: string,
  body: File,
  submission: MediaSubmissionRef,
  signal: AbortSignal,
  progress?: (message: string) => void,
  timeoutMs?: number,
): Promise<Project>;
export async function submitMedia(
  transport: AccountFetch,
  endpoint: string,
  body: FormData | File,
  submission: MediaSubmissionRef,
  signal: AbortSignal,
  progress: (message: string) => void = () => {},
  timeoutMs = 120000,
): Promise<Project | AssetUpdate> {
  signal.throwIfAborted();
  progress("Checking file…");
  const metadata = await intent(body);
  if (metadata.operation === "upload" && body instanceof FormData) {
    const file = body.get("file");
    if (!(file instanceof File)) throw new Error("Choose a media file.");
    body.set("file", file, metadata.name);
    body.set("license", metadata.license);
    body.set("kind", metadata.kind);
  }
  const fingerprint = await digest(
    new TextEncoder().encode(JSON.stringify(metadata)),
  );
  signal.throwIfAborted();
  if (
    !submission.current ||
    submission.current.endpoint !== endpoint ||
    submission.current.fingerprint !== fingerprint
  ) {
    // A different file replaces an unfinished upload: release its pieces.
    const abandoned = submission.current?.uploadId;
    if (abandoned && !submission.current?.requestId)
      void transport(`/api/uploads/${abandoned}`, { method: "DELETE" }).catch(
        () => {},
      );
    submission.current = { endpoint, fingerprint, key: crypto.randomUUID() };
  }
  const current = submission.current;
  let result: MediaReceipt | undefined;
  if (!current.requestId) {
    const file =
      body instanceof File ? body : (body.get("file") as File | null);
    const pieces = !!file && staged(file);
    if (pieces)
      await sendStaged(
        transport,
        endpoint,
        file,
        metadata,
        current,
        signal,
        progress,
      );
    else progress("Uploading file…");
    const response = await transport(
      endpoint,
      pieces
        ? {
            method: "POST",
            headers: {
              Prefer: "respond-async",
              "Idempotency-Key": current.key,
              "X-Reelchemy-Upload-Session": current.uploadId!,
            },
            signal: AbortSignal.any([signal, AbortSignal.timeout(95000)]),
          }
        : {
            method: "POST",
            body,
            headers: {
              Prefer: "respond-async",
              "Idempotency-Key": current.key,
              "X-Reelchemy-Media-Intent": current.fingerprint,
              ...(metadata.operation === "import"
                ? { "Content-Type": "application/zip" }
                : {}),
            },
            signal: AbortSignal.any([signal, AbortSignal.timeout(95000)]),
          },
    );
    const payload = await response.json();
    if (!response.ok) {
      if (
        response.headers.get("X-Reelchemy-Media-Not-Queued") === "1" &&
        submission.current?.key === current.key
      )
        // Not queued: a retry gets a fresh request, but keeps a file that
        // already arrived in pieces.
        submission.current = pieces
          ? { ...current, key: crypto.randomUUID(), requestId: undefined }
          : null;
      throw new Error(
        payload.error || "Media could not be queued. Keep your file and retry.",
      );
    }
    if (response.status === 201) {
      if (
        typeof payload?.id !== "string" ||
        (metadata.operation === "upload" &&
          (endpoint !== `/api/projects/${payload.id}/assets` ||
            !Array.isArray(payload.assets)))
      )
        throw new Error(
          "The completed result was incomplete. Keep your file and retry to recover it.",
        );
      signal.throwIfAborted();
      if (submission.current?.key === current.key) submission.current = null;
      notify();
      return metadata.operation === "upload"
        ? ({ id: payload.id, assets: payload.assets } satisfies AssetUpdate)
        : (payload as Project);
    }
    if (response.status !== 202)
      throw new Error(
        "The processing response was incomplete. Keep your file and retry.",
      );
    result = receipt(payload.request);
    current.requestId = result.id;
    notify();
  }
  const deadline = Date.now() + timeoutMs;
  while (!signal.aborted && Date.now() < deadline) {
    if (!result) {
      const response = await transport(
        `/api/media-requests/${current.requestId}`,
        {
          cache: "no-store",
          signal: AbortSignal.any([signal, AbortSignal.timeout(10000)]),
        },
      );
      const payload = await response.json();
      if (!response.ok)
        throw new Error(
          payload.error ||
            "Could not check media processing. Keep your file and retry.",
        );
      result = receipt(payload.request);
    }
    if (
      result.id !== current.requestId ||
      result.operation !== metadata.operation
    )
      throw new Error(
        "The processing response did not match this upload. Keep your file and refresh the studio.",
      );
    if (["failed", "cancelled"].includes(result.state)) {
      if (submission.current?.key === current.key) submission.current = null;
      notify();
      throw new Error(failureMessage(result));
    }
    if (result.state === "completed") {
      const expectedAssetId = result.resultId;
      const projectId =
        result.operation === "import" ? result.resultId : result.projectId;
      if (
        typeof projectId !== "string" ||
        !/^[a-zA-Z0-9_-]{1,80}$/.test(projectId) ||
        (metadata.operation === "upload" &&
          endpoint !== `/api/projects/${projectId}/assets`)
      )
        throw new Error(
          "The completed result did not match this project. Refresh the studio to review it.",
        );
      const options = {
        cache: "no-store",
        signal: AbortSignal.any([
          signal,
          AbortSignal.timeout(metadata.operation === "import" ? 60000 : 10000),
        ]),
      } satisfies RequestInit;
      let response = await transport(
        metadata.operation === "upload"
          ? endpoint
          : `/api/projects/${projectId}`,
        options,
      );
      // An already-open browser may outlive a coordinated server rollback.
      // Older releases have no catalogue GET but still authorize project GET.
      if (metadata.operation === "upload" && response.status === 405)
        response = await transport(`/api/projects/${projectId}`, options);
      const project = await response.json();
      if (!response.ok)
        throw new Error(
          project.error ||
            "Media is ready but the project could not be refreshed. Retry to recover it.",
        );
      if (project.id !== projectId)
        throw new Error(
          "The completed project response was incomplete. Retry to recover it.",
        );
      if (
        metadata.operation === "upload" &&
        (!Array.isArray(project.assets) ||
          !project.assets.some(
            (asset: { id?: unknown }) => asset?.id === expectedAssetId,
          ))
      )
        throw new Error(
          "Media is ready but its catalogue could not be refreshed. Retry to recover it.",
        );
      signal.throwIfAborted();
      if (submission.current?.key === current.key) submission.current = null;
      notify();
      return metadata.operation === "upload"
        ? ({ id: projectId, assets: project.assets } satisfies AssetUpdate)
        : (project as Project);
    }
    progress(
      result.state === "receiving"
        ? "Receiving file…"
        : result.state === "queued"
          ? "Waiting for media processing…"
          : result.state === "cancelling"
            ? "Cancelling media processing…"
            : "Preparing media…",
    );
    await clientWait(750, signal);
    result = undefined;
  }
  signal.throwIfAborted();
  throw new MediaStillProcessing();
}
