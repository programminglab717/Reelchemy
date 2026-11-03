import {
  ExportStorageLimit,
  ExportStorageUnavailable,
} from "./export-storage-policy";
import { ZodError } from "zod";
import { RevisionConflict } from "./editor";
import { ExportRequestConflict, ExportCapacityError } from "./export-policy";
import { RequestRateError, LimitConfigurationError } from "./limits-policy";
import { MediaStorageLimitError } from "./media-storage-policy";
import { ProviderError } from "./provider-error";
import { ProjectDeletionConflict } from "./project-deletion-policy";
import { ProjectStorageLimit } from "./project-storage-policy";
import {
  MediaProcessingCapacity,
  MediaProcessingConflict,
  MediaProcessingUnavailable,
  MediaAnalysisLimit,
} from "./media-processing-policy";
export class RequestBodyError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}
export function failure(error: unknown) {
  if (
    error instanceof ExportStorageLimit ||
    error instanceof ExportStorageUnavailable
  )
    return Response.json(
      {
        error: error.message,
        code: error.code,
        ...(error instanceof ExportStorageLimit
          ? { scope: error.scope, kind: error.kind }
          : {}),
      },
      {
        status:
          error instanceof ExportStorageLimit && error.scope === "studio"
            ? 413
            : 503,
        headers: {
          "Cache-Control": "private, no-store",
          "X-Content-Type-Options": "nosniff",
          "Retry-After": "30",
        },
      },
    );

  if (error instanceof ProjectStorageLimit)
    return Response.json(
      {
        error: error.message,
        code: error.code,
        scope: error.scope,
        kind: error.kind,
      },
      {
        status: error.scope === "service" ? 503 : 413,
        headers: {
          "Cache-Control": "private, no-store",
          "X-Content-Type-Options": "nosniff",
        },
      },
    );
  if (error instanceof MediaAnalysisLimit)
    return Response.json(
      { error: error.message, code: error.code, retryAfter: error.retryAfter },
      {
        status: 429,
        headers: {
          "Cache-Control": "private, no-store",
          "Retry-After": String(error.retryAfter),
        },
      },
    );
  if (error instanceof MediaProcessingCapacity)
    return Response.json(
      {
        error: error.message,
        code: error.code,
        scope: error.scope,
        retryAfter: error.retryAfter,
      },
      {
        status: error.scope === "studio" ? 429 : 503,
        headers: {
          "Cache-Control": "private, no-store",
          "Retry-After": String(error.retryAfter),
        },
      },
    );
  if (
    error instanceof MediaProcessingConflict ||
    error instanceof MediaProcessingUnavailable
  )
    return Response.json(
      { error: error.message, code: error.code },
      { status: 409, headers: { "Cache-Control": "private, no-store" } },
    );
  if (error instanceof RequestBodyError)
    return Response.json(
      { error: error.message },
      {
        status: error.status,
        headers: { "Cache-Control": "private, no-store" },
      },
    );
  if (error instanceof ProjectDeletionConflict)
    return Response.json(
      { error: error.message, code: "PROJECT_DELETION_CONFLICT" },
      { status: 409, headers: { "Cache-Control": "private, no-store" } },
    );
  if (error instanceof ProviderError)
    return Response.json(
      { error: error.message, code: error.code },
      {
        status: error.status,
        headers: {
          "Cache-Control": "private, no-store",
          ...(error.retryAfter
            ? { "Retry-After": String(error.retryAfter) }
            : {}),
        },
      },
    );
  if (error instanceof ExportCapacityError)
    return Response.json(
      {
        error: error.message,
        code: "EXPORT_CAPACITY",
        scope: error.scope,
        retryAfter: error.retryAfter,
      },
      {
        status: error.scope === "studio" ? 429 : 503,
        headers: {
          "Cache-Control": "private, no-store",
          "Retry-After": String(error.retryAfter),
        },
      },
    );
  if (error instanceof ExportRequestConflict)
    return Response.json(
      { error: error.message, code: "EXPORT_REQUEST_CONFLICT" },
      { status: 409, headers: { "Cache-Control": "private, no-store" } },
    );
  if (error instanceof MediaStorageLimitError && error.scope === "service")
    return Response.json(
      { error: error.message, code: error.code, scope: "service" },
      {
        status: 503,
        headers: {
          "Cache-Control": "private, no-store",
          "X-Content-Type-Options": "nosniff",
        },
      },
    );
  if (error instanceof MediaStorageLimitError)
    return Response.json(
      {
        error: error.message,
        code: error.code,
        usedBytes: error.usedBytes,
        limitBytes: error.limitBytes,
        requiredBytes: error.requiredBytes,
        remainingBytes: Math.max(0, error.limitBytes - error.usedBytes),
      },
      { status: 413, headers: { "Cache-Control": "private, no-store" } },
    );
  if (error instanceof RequestRateError)
    return Response.json(
      {
        error: error.message,
        code: "RATE_LIMITED",
        retryAfter: error.retryAfter,
      },
      {
        status: 429,
        headers: {
          "Retry-After": String(error.retryAfter),
          "Cache-Control": "private, no-store",
        },
      },
    );
  if (error instanceof LimitConfigurationError)
    return Response.json(
      { error: error.message, code: "LIMIT_CONFIGURATION" },
      { status: 503 },
    );
  if (error instanceof RevisionConflict)
    return Response.json(
      { error: error.message, code: "REVISION_CONFLICT" },
      { status: 409 },
    );
  if (error instanceof ZodError)
    return Response.json(
      {
        error: error.issues
          .map((i) => `${i.path.join(".")}: ${i.message}`)
          .join("; "),
      },
      { status: 400 },
    );
  const message = error instanceof Error ? error.message : "Request failed";
  return Response.json({ error: message }, { status: 400 });
}
export function localMutation(req: Request) {
  const origin = req.headers.get("origin");
  if (origin && new URL(origin).host !== req.headers.get("host"))
    throw new Error("Cross-origin writes are not allowed.");
}
export async function readLimitedBody(
  req: Request,
  maxBytes: number,
  options: { timeoutMs?: number; cancelled?: () => boolean } = {},
) {
  if (Number(req.headers.get("content-length") || 0) > maxBytes)
    throw new RequestBodyError("Request too large.");
  const reader = req.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let size = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let rejectRead: (error: Error) => void = () => {};
  const interrupted = new Promise<never>((_resolve, reject) => {
    rejectRead = reject;
  });
  const abort = () =>
    rejectRead(
      new RequestBodyError(
        "Upload interrupted. Keep your file and try again.",
        408,
      ),
    );
  req.signal.addEventListener("abort", abort, { once: true });
  if (options.timeoutMs !== undefined)
    timer = setTimeout(
      () =>
        rejectRead(
          new RequestBodyError(
            "Upload timed out. Keep your file and try again.",
            408,
          ),
        ),
      options.timeoutMs,
    );
  const checkCancellation = () => {
    try {
      if (options.cancelled?.())
        rejectRead(
          new RequestBodyError(
            "Upload cancelled. Your file has not been added.",
            409,
          ),
        );
    } catch {
      rejectRead(
        new RequestBodyError(
          "Upload status is unavailable. Keep your file and retry.",
          503,
        ),
      );
    }
  };
  const poll = options.cancelled
    ? setInterval(checkCancellation, 100)
    : undefined;
  try {
    if (req.signal.aborted) abort();
    checkCancellation();
    while (true) {
      const { done, value } = await Promise.race([reader.read(), interrupted]);
      if (done) break;
      size += value.length;
      if (size > maxBytes) {
        throw new RequestBodyError("Request too large.");
      }
      chunks.push(value);
    }
  } catch (error) {
    void reader.cancel().catch(() => {});
    throw error;
  } finally {
    clearTimeout(timer);
    clearInterval(poll);
    req.signal.removeEventListener("abort", abort);
    reader.releaseLock();
  }
  const result = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}
export async function body(req: Request) {
  return JSON.parse(
    new TextDecoder().decode(await readLimitedBody(req, 100000)),
  );
}
export async function multipart(
  req: Request,
  maxBytes = 11 * 1024 * 1024,
  options: { timeoutMs?: number; cancelled?: () => boolean } = {},
) {
  const bytes = await readLimitedBody(req, maxBytes, options);
  return new Request(req.url, {
    method: "POST",
    headers: { "content-type": req.headers.get("content-type") || "" },
    body: bytes,
  }).formData();
}
