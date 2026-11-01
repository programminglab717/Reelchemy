import { ProviderError } from "./provider-error";

export const MAX_PROVIDER_RESPONSE_BYTES = 512 * 1024;

async function readChunk(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  signal: AbortSignal,
) {
  signal.throwIfAborted();
  let abort: () => void = () => {};
  const cancelled = new Promise<never>((_, reject) => {
    abort = () => reject(new ProviderError("timeout"));
    signal.addEventListener("abort", abort, { once: true });
  });
  try {
    return await Promise.race([reader.read(), cancelled]);
  } finally {
    signal.removeEventListener("abort", abort);
  }
}

export async function readProviderResponse(
  response: Response,
  signal: AbortSignal,
): Promise<unknown> {
  const reader = response.body?.getReader();
  if (!reader) throw new ProviderError("response");
  const chunks: Uint8Array[] = [];
  let size = 0;
  let complete = false;
  try {
    const claimed = response.headers.get("content-length");
    if (claimed && Number(claimed) > MAX_PROVIDER_RESPONSE_BYTES)
      throw new ProviderError("response");
    while (true) {
      const { done, value } = await readChunk(reader, signal);
      if (done) break;
      size += value.byteLength;
      if (size > MAX_PROVIDER_RESPONSE_BYTES)
        throw new ProviderError("response");
      chunks.push(value);
    }
    complete = true;
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch (error) {
    if (signal.aborted) throw new ProviderError("timeout");
    if (error instanceof ProviderError) throw error;
    throw new ProviderError("response");
  } finally {
    // A stalled or failed upstream must not delay returning the safe error.
    if (!complete) void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
