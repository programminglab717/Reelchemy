import { ZodError } from "zod";
import { RevisionConflict } from "./editor";
import { ExportRequestConflict, ExportCapacityError } from "./export-policy";
import { RequestRateError, LimitConfigurationError } from "./limits-policy";
import { MediaStorageLimitError } from "./media-storage-policy";
import { ProviderError } from "./provider-error";
export function failure(error: unknown) {
  if (error instanceof ProviderError)
    return Response.json(
      { error: error.message, code: error.code },
      {
        status: error.status,
        headers: { "Cache-Control": "private, no-store" },
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
export async function readLimitedBody(req: Request, maxBytes: number) {
  if (Number(req.headers.get("content-length") || 0) > maxBytes)
    throw new Error("Request too large.");
  const reader = req.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > maxBytes) {
        await reader.cancel();
        throw new Error("Request too large.");
      }
      chunks.push(value);
    }
  } finally {
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
export async function multipart(req: Request, maxBytes = 11 * 1024 * 1024) {
  const bytes = await readLimitedBody(req, maxBytes);
  return new Request(req.url, {
    method: "POST",
    headers: { "content-type": req.headers.get("content-type") || "" },
    body: bytes,
  }).formData();
}
