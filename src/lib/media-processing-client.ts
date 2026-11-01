import type { AccountFetch } from "./account-fetch";
import type { MediaInput, MediaReceipt } from "./media-processing-store";
import type { Project } from "./schema";
import { clientWait } from "./client-wait";
import { mediaUploadName, MEDIA_PROCESSING_EVENT } from "./media-upload-intent";

export type MediaSubmission = {
  endpoint: string;
  fingerprint: string;
  key: string;
  requestId?: string;
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
async function intent(body: FormData | File): Promise<MediaInput> {
  if (body instanceof FormData) {
    const kind = body.get("kind") || "image",
      file = body.get("file");
    if (
      !["image", "audio", "video"].includes(String(kind)) ||
      !(file instanceof File)
    )
      throw new Error("Choose an image, audio or video file.");
    const license = String(body.get("license") || "")
      .replace(/\r\n?|\n/g, "\r\n")
      .trim();
    if (license.length < 3 || license.length > 500)
      throw new Error(
        "Describe your source or usage rights in 3–500 characters.",
      );
    if (!file.size || file.size > (kind === "video" ? 25 : 10) * 1024 * 1024)
      throw new Error(
        kind === "video"
          ? "Choose a video up to 25 MB."
          : "Choose an image or audio file up to 10 MB.",
      );
    return {
      operation: "upload",
      name: mediaUploadName(file.name, kind as "image" | "audio" | "video"),
      kind: kind as "image" | "audio" | "video",
      license,
      bytes: file.size,
      sha256: await digest(new Uint8Array(await file.arrayBuffer())),
    };
  }
  if (!body.size || body.size > 50 * 1024 * 1024)
    throw new Error("Choose a project archive up to 50 MB.");
  return {
    operation: "import",
    bytes: body.size,
    sha256: await digest(new Uint8Array(await body.arrayBuffer())),
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
  if (result.error === "PROJECT_UNAVAILABLE")
    return "The target project is no longer available. Keep your file and open an active project.";
  if (result.error === "PROCESSING_TIMEOUT")
    return "Preparing this file took too long. Try a smaller or shorter file.";
  if (result.error === "INTERRUPTED")
    return "Media processing was interrupted twice. Keep your file and retry with a new request.";
  return "This file could not be processed. Check its format, dimensions and duration, then retry or choose another file.";
}
export async function submitMedia(
  transport: AccountFetch,
  endpoint: string,
  body: FormData | File,
  submission: MediaSubmissionRef,
  signal: AbortSignal,
  progress: (message: string) => void = () => {},
  timeoutMs = 120000,
): Promise<Project> {
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
  )
    submission.current = { endpoint, fingerprint, key: crypto.randomUUID() };
  const current = submission.current;
  let result: MediaReceipt | undefined;
  if (!current.requestId) {
    progress("Uploading file…");
    const response = await transport(endpoint, {
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
    });
    const payload = await response.json();
    if (!response.ok) {
      if (
        response.headers.get("X-Reelchemy-Media-Not-Queued") === "1" &&
        submission.current?.key === current.key
      )
        submission.current = null;
      throw new Error(
        payload.error || "Media could not be queued. Keep your file and retry.",
      );
    }
    if (response.status === 201) {
      signal.throwIfAborted();
      if (submission.current?.key === current.key) submission.current = null;
      notify();
      return payload as Project;
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
      const response = await transport(`/api/projects/${projectId}`, {
        cache: "no-store",
        signal: AbortSignal.any([signal, AbortSignal.timeout(10000)]),
      });
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
      signal.throwIfAborted();
      if (submission.current?.key === current.key) submission.current = null;
      notify();
      return project as Project;
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
