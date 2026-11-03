import { privateFileHeaders } from "./private-file";
// Two review leases in the caller bound full activity buffers. Copy each chunk
// so an outbound socket holding its last 64 KiB cannot pin an entire archive.
export function privateJsonDownload(
  text: string,
  filename: string,
  onClose: () => void,
  signal?: AbortSignal,
  timeoutMs = 20000,
) {
  if (!/^[a-zA-Z0-9_-][a-zA-Z0-9_.-]{0,119}$/.test(filename))
    throw new Error("Invalid private download name.");
  let bytes: Buffer | undefined = Buffer.from(text, "utf8");
  text = "";
  if (bytes.length > 8 * 1024 ** 2 + 4096)
    throw new Error("Private activity download is too large.");
  const length = bytes.length;
  let offset = 0,
    closed = false,
    controller: ReadableStreamDefaultController<Uint8Array>;
  const release = () => {
    if (closed) return;
    closed = true;
    bytes = undefined;
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
    onClose();
  };
  const abort = () => {
    if (closed) return;
    controller.error(new Error("Private activity download interrupted."));
    release();
  };
  const body = new ReadableStream<Uint8Array>(
    {
      start(value) {
        controller = value;
      },
      pull(value) {
        if (closed || !bytes) return;
        const end = Math.min(bytes.length, offset + 64 * 1024),
          chunk = new Uint8Array(bytes.subarray(offset, end));
        offset = end;
        value.enqueue(chunk);
        if (offset === length) {
          value.close();
          release();
        }
      },
      cancel() {
        release();
      },
    },
    { highWaterMark: 0 },
  );
  const timer = setTimeout(abort, Math.max(1, Math.min(20000, timeoutMs)));
  signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted) abort();
  try {
    return new Response(body, {
      headers: {
        ...privateFileHeaders,
        "Content-Type": "application/json; charset=utf-8",
        "Content-Length": String(length),
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (error) {
    release();
    throw error;
  }
}
