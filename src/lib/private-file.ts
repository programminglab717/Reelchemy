import { constants } from "node:fs";
import { open, type FileHandle } from "node:fs/promises";
import path from "node:path";
import { byteRange } from "./media-range";

export const privateFileHeaders = {
  "Cache-Control": "private, no-store",
  "X-Content-Type-Options": "nosniff",
};
export function privateFileMissing() {
  return new Response(null, { status: 404, headers: privateFileHeaders });
}
export function privateFileRoute<Context>(
  handler: (request: Request, context: Context) => Promise<Response>,
) {
  return async (request: Request, context: Context) => {
    const response = await handler(request, context);
    for (const [key, value] of Object.entries(privateFileHeaders))
      response.headers.set(key, value);
    return response;
  };
}

// Linux is the supported production runtime. Walk directories through held
// descriptors, including configured ancestors, so a replacement path cannot
// redirect a private read. No user-controlled absolute path is accepted.
async function openPrivateFile(root: string, names: readonly string[]) {
  if (
    !names.length ||
    names.some((name) => !/^[a-zA-Z0-9_-][a-zA-Z0-9_.-]{0,127}$/.test(name))
  )
    throw new Error("Private file unavailable.");
  let directory: FileHandle | undefined;
  try {
    directory = await open(
      path.parse(path.resolve(root)).root,
      constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
    );
    const parts = [
      ...path.resolve(root).split(path.sep).filter(Boolean),
      ...names,
    ];
    for (let i = 0; i < parts.length; i++) {
      const last = i === parts.length - 1;
      const next = await open(
        `/proc/self/fd/${directory.fd}/${parts[i]}`,
        constants.O_RDONLY |
          constants.O_NOFOLLOW |
          constants.O_NONBLOCK |
          (last ? 0 : constants.O_DIRECTORY),
      );
      if (last) return next;
      const previous = directory;
      directory = next;
      await previous.close();
    }
    throw new Error("Private file unavailable.");
  } finally {
    await directory?.close();
  }
}

// One descriptor and at most one 64 KiB application buffer per response.
// The caller performs account/actor/active-owner checks before invoking this.
export async function privateFileResponse(
  request: Request,
  root: string,
  names: readonly string[],
  mime: string,
  disposition?: string,
) {
  let file: FileHandle | undefined;
  try {
    if (request.signal.aborted) return privateFileMissing();
    file = await openPrivateFile(root, names);
    const initial = await file.stat({ bigint: true });
    const size = Number(initial.size);
    if (!initial.isFile() || !Number.isSafeInteger(size) || size < 0)
      throw new Error("Private file unavailable.");
    let range;
    try {
      range = byteRange(
        // We issue no representation validator. An If-Range validator cannot
        // be established as a match, so send the complete representation.
        request.method === "HEAD" || request.headers.has("if-range")
          ? null
          : request.headers.get("range"),
        size,
      );
    } catch {
      return new Response(null, {
        status: 416,
        headers: { ...privateFileHeaders, "Content-Range": `bytes */${size}` },
      });
    }
    const headers = {
      ...privateFileHeaders,
      "Content-Type": mime,
      "Accept-Ranges": "bytes",
      "Content-Length": String(range ? range.end - range.start + 1 : size),
      ...(range
        ? { "Content-Range": `bytes ${range.start}-${range.end}/${size}` }
        : {}),
      ...(disposition ? { "Content-Disposition": disposition } : {}),
    };
    if (request.method === "HEAD" || size === 0)
      return new Response(null, { status: 200, headers });
    const handle = file;
    let position = range?.start ?? 0;
    const end = range?.end ?? size - 1;
    let ended = false,
      closing: Promise<void> | undefined;
    const close = () => {
      ended = true;
      request.signal.removeEventListener("abort", abort);
      return (closing ??= handle.close());
    };
    let controller: ReadableStreamDefaultController<Uint8Array>;
    const abort = () => {
      if (!ended)
        controller.error(new Error("Private file transfer interrupted."));
      void close().catch(() => {});
    };
    const body = new ReadableStream<Uint8Array>(
      {
        start(value) {
          controller = value;
        },
        async pull(value) {
          if (ended) return;
          try {
            const buffer = Buffer.allocUnsafe(
              Math.min(64 * 1024, end - position + 1),
            );
            const { bytesRead } = await handle.read(
              buffer,
              0,
              buffer.length,
              position,
            );
            const current = await handle.stat({ bigint: true });
            if (
              bytesRead !== buffer.length ||
              current.size !== initial.size ||
              current.mtimeNs !== initial.mtimeNs ||
              current.ctimeNs !== initial.ctimeNs
            )
              throw new Error("Private file transfer interrupted.");
            if (ended) return;
            position += bytesRead;
            value.enqueue(buffer);
            if (position > end) {
              value.close();
              await close();
            }
          } catch {
            if (!ended)
              value.error(new Error("Private file transfer interrupted."));
            await close();
          }
        },
        async cancel() {
          await close();
        },
      },
      { highWaterMark: 0 },
    );
    request.signal.addEventListener("abort", abort, { once: true });
    if (request.signal.aborted) abort();
    const response = new Response(body, { status: range ? 206 : 200, headers });
    file = undefined; // The body now owns descriptor lifetime, including cancel.
    return response;
  } catch {
    return privateFileMissing();
  } finally {
    await file?.close();
  }
}
