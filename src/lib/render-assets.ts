import { createServer } from "node:http";
import { Readable } from "node:stream";
import { constants } from "node:fs";
import { open, type FileHandle } from "node:fs/promises";
import path from "node:path";
import { randomBytes, createHash } from "node:crypto";
import { assetDir } from "./assets";
import { validAssetId } from "./project-assets";
import { sniffFontMime } from "./fonts";
import { serveMotionFile } from "../motion/motion-files";
import { byteRange } from "./media-range";
import { CommandCancelledError } from "./process";
import type { Timeline } from "./schema";
import { MAX_STORED_ASSET_BYTES } from "./timeline-limits";

// Job-scoped capabilities, bound only to loopback. No user-controlled URL or
// filesystem path is served, and no normalized media is embedded in props.
export async function serveRenderAssets(
  timeline: Timeline,
  isCancelled: () => boolean = () => false,
) {
  const types = new Map<string, string>();
  const checkCancellation = () => {
    if (isCancelled()) throw new CommandCancelledError();
  };
  checkCancellation();
  function allow(id: string, mime: string) {
    if (!validAssetId(id)) throw new Error("Invalid render asset.");
    if (types.has(id) && types.get(id) !== mime)
      throw new Error("Conflicting render asset types.");
    types.set(id, mime);
  }
  for (const scene of timeline.scenes)
    for (const layer of scene.layers)
      if (layer.assetId)
        allow(
          layer.assetId,
          layer.kind === "video" ? "video/mp4" : "image/png",
        );
  for (const track of timeline.audioTracks || [])
    allow(track.assetId, "audio/wav");
  // A font's served type comes from its verified signature when opened.
  for (const scene of timeline.scenes)
    for (const layer of scene.layers)
      if (layer.fontAssetId) allow(layer.fontAssetId, "font");
  const fingerprints: Record<string, string> = {};
  const sources: Record<string, string> = {};
  const files = new Map<
    string,
    { handle: FileHandle; size: number; mime: string }
  >();
  async function closeFiles() {
    const results = await Promise.allSettled(
      [...files.values()].map((f) => f.handle.close()),
    );
    const failure = results.find((r) => r.status === "rejected");
    if (failure?.status === "rejected") throw failure.reason;
  }
  try {
    for (const [id, mime] of types) {
      checkCancellation();
      // Nonblocking open also avoids hanging on a substituted pipe/device.
      // Keep the descriptor for this attempt: replacement paths cannot change
      // which file was fingerprinted and served to concurrent frame requests.
      let handle: FileHandle;
      try {
        handle = await open(
          path.join(assetDir, id),
          constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
        );
      } catch {
        throw new Error("Missing or invalid render asset.");
      }
      files.set(id, { handle, size: 0, mime });
      const metadata = await handle.stat();
      if (
        !metadata.isFile() ||
        metadata.size < 1 ||
        metadata.size > MAX_STORED_ASSET_BYTES
      )
        throw new Error("Render assets must be bounded regular media files.");
      files.get(id)!.size = metadata.size;
      if (mime === "font") {
        const head = Buffer.alloc(Math.min(64, metadata.size));
        await handle.read(head, 0, head.length, 0);
        const sniffed = sniffFontMime(head);
        if (!sniffed) throw new Error("Render font is not a font file.");
        files.get(id)!.mime = sniffed;
      }
      const hash = createHash("sha256");
      const buffer = Buffer.allocUnsafe(64 * 1024);
      let position = 0;
      while (position < metadata.size) {
        checkCancellation();
        const { bytesRead } = await handle.read(
          buffer,
          0,
          Math.min(buffer.length, metadata.size - position),
          position,
        );
        if (!bytesRead)
          throw new Error("Render media changed while preparing the export.");
        hash.update(buffer.subarray(0, bytesRead));
        position += bytesRead;
      }
      fingerprints[id] = hash.digest("hex");
    }
    checkCancellation();
  } catch (error) {
    await closeFiles();
    throw error;
  }
  // Code scenes load the allowlisted motion libraries from this server too.
  const motion = timeline.scenes.some((scene) => !!scene.code);
  if (!files.size && !motion)
    return { sources, fingerprints, motionBaseUrl: "", close: async () => {} };
  const token = randomBytes(32).toString("hex");
  const server = createServer((req, res) => {
    const library = new RegExp(`^/${token}/motion/([A-Za-z0-9./-]+)$`).exec(
      req.url || "",
    );
    if (library) {
      const served = motion ? serveMotionFile(library[1]) : null;
      if (!served) {
        res.writeHead(404).end();
        return;
      }
      if (req.method !== "GET" && req.method !== "HEAD") {
        res.writeHead(405, { Allow: "GET, HEAD" }).end();
        return;
      }
      const { bytes, type } = served;
      res.writeHead(200, {
        "Content-Type": type,
        "Content-Length": String(bytes.length),
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        // Scene documents run with an opaque origin.
        "Access-Control-Allow-Origin": "*",
      });
      res.end(req.method === "HEAD" ? undefined : bytes);
      return;
    }
    const match = new RegExp(`^/${token}/([a-f0-9-]{36})$`).exec(req.url || "");
    const file = match ? files.get(match[1]) : undefined;
    if (!file) {
      res.writeHead(404).end();
      return;
    }
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.writeHead(405, { Allow: "GET, HEAD" }).end();
      return;
    }
    let range;
    try {
      range = byteRange(req.headers.range || null, file.size);
    } catch {
      res.writeHead(416, { "Content-Range": `bytes */${file.size}` }).end();
      return;
    }
    res.writeHead(range ? 206 : 200, {
      "Content-Type": file.mime,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      // Chromium's media elements may use CORS across the renderer's random
      // port. Knowing this private per-attempt capability is still required.
      "Access-Control-Allow-Origin": "*",
      "Accept-Ranges": "bytes",
      "Content-Length": String(range ? range.end - range.start + 1 : file.size),
      ...(range
        ? { "Content-Range": `bytes ${range.start}-${range.end}/${file.size}` }
        : {}),
    });
    if (req.method === "HEAD") {
      res.end();
      return;
    }
    // A request owns only this bounded read loop, never the shared descriptor.
    // Destroying a FileHandle-backed ReadStream closes its fd even when normal
    // end auto-close is disabled, breaking later/concurrent range requests.
    const stream = Readable.from(
      (async function* () {
        let position = range?.start ?? 0;
        const end = range?.end ?? file.size - 1;
        while (position <= end) {
          const buffer = Buffer.allocUnsafe(
            Math.min(64 * 1024, end - position + 1),
          );
          const { bytesRead } = await file.handle.read(
            buffer,
            0,
            buffer.length,
            position,
          );
          if (!bytesRead)
            throw new Error("Render media changed during export.");
          position += bytesRead;
          yield buffer.subarray(0, bytesRead);
        }
      })(),
      { objectMode: false, highWaterMark: 64 * 1024 },
    );
    stream.on("error", () => res.destroy());
    res.on("close", () => stream.destroy());
    stream.pipe(res);
  });
  server.requestTimeout = 60000;
  server.headersTimeout = 10000;
  server.on("clientError", (_, socket) => socket.destroy());
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
  } catch (error) {
    await closeFiles();
    throw error;
  }
  const address = server.address();
  if (!address || typeof address === "string") {
    server.closeAllConnections();
    server.close();
    await closeFiles();
    throw new Error("Could not serve render media.");
  }
  for (const id of files.keys())
    sources[id] = `http://127.0.0.1:${address.port}/${token}/${id}`;
  let closing: Promise<void> | undefined;
  return {
    sources,
    fingerprints,
    motionBaseUrl: motion
      ? `http://127.0.0.1:${address.port}/${token}/motion`
      : "",
    close: () =>
      (closing ??= (async () => {
        try {
          await new Promise<void>((resolve, reject) => {
            server.close((e) => (e ? reject(e) : resolve()));
            server.closeAllConnections();
          });
        } finally {
          await closeFiles();
        }
      })()),
  };
}
