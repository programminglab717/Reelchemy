const MAX_ARCHIVE_BYTES = 50 * 1024 * 1024;
async function readBounded(response: Response, limit: number) {
  // Fetch exposes decompressed bytes; an encoded Content-Length describes
  // the wire representation, while the streaming cap still bounds the ZIP.
  const encoding = response.headers.get("content-encoding");
  const declared =
    !encoding || encoding.toLowerCase() === "identity"
      ? response.headers.get("content-length")
      : null;
  if (
    declared !== null &&
    (!/^\d+$/.test(declared) || Number(declared) > limit)
  ) {
    await response.body?.cancel();
    throw new Error("The archive response exceeds its download limit.");
  }
  if (!response.body) throw new Error("The archive response was empty.");
  const reader = response.body.getReader();
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > limit)
        throw new Error("The archive response exceeds its download limit.");
      chunks.push(value);
    }
    if (declared !== null && total !== Number(declared))
      throw new Error(
        "The editable project ZIP was incomplete. Retry the download.",
      );
    return { chunks, total };
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
export async function archiveDownload(response: Response): Promise<Blob> {
  if (!response.ok) {
    let message =
      "The editable project could not be downloaded. Your work is still here; retry when ready.";
    try {
      const { chunks } = await readBounded(response, 16000);
      const error: unknown = JSON.parse(await new Blob(chunks).text());
      if (
        error &&
        typeof error === "object" &&
        "error" in error &&
        typeof error.error === "string" &&
        error.error.length <= 1000
      )
        message = error.error;
    } catch {
      /* Proxy/oversized responses must not become downloaded files. */
    }
    throw new Error(message);
  }
  if (
    response.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !==
    "application/zip"
  ) {
    await response.body?.cancel();
    throw new Error(
      "The server did not return an editable project ZIP. Retry the download.",
    );
  }
  const { chunks, total } = await readBounded(response, MAX_ARCHIVE_BYTES);
  const blob = new Blob(chunks, { type: "application/zip" });
  const signature = new Uint8Array(await blob.slice(0, 4).arrayBuffer());
  if (
    total < 22 ||
    signature[0] !== 0x50 ||
    signature[1] !== 0x4b ||
    signature[2] !== 3 ||
    signature[3] !== 4
  )
    throw new Error(
      "The editable project ZIP was incomplete. Retry the download.",
    );
  return blob;
}
