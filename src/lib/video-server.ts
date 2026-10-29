import { createServer } from "node:http";
import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { randomBytes, createHash } from "node:crypto";
import { assetDir, validAssetId } from "./assets";
import { byteRange } from "./media-range";
import type { Timeline } from "./schema";
// Worker-only, loopback-bound capability server. Never serves a directory or an
// arbitrary supplied path/URL; the allowlist is the immutable job's footage IDs.
export async function serveVideoAssets(
  timeline: Timeline,
  sources: Record<string, string>,
) {
  const ids = new Set(
    timeline.scenes.flatMap((s) =>
      s.layers.filter((l) => l.kind === "video").map((l) => l.assetId!),
    ),
  );
  const fingerprints: Record<string, string> = {};
  for (const id of ids) {
    if (!validAssetId(id)) throw new Error("Invalid video asset.");
    fingerprints[id] = createHash("sha256")
      .update(await readFile(path.join(assetDir, id)))
      .digest("hex");
  }
  if (!ids.size) return { sources, fingerprints, close: async () => {} };
  const token = randomBytes(32).toString("hex");
  const server = createServer(async (req, res) => {
    const match = new RegExp(`^/${token}/([a-f0-9-]{36})$`).exec(req.url || "");
    if (!match || !ids.has(match[1])) {
      res.writeHead(404).end();
      return;
    }
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.writeHead(405).end();
      return;
    }
    try {
      const file = path.join(assetDir, match[1]),
        size = (await stat(file)).size;
      let range;
      try {
        range = byteRange(req.headers.range || null, size);
      } catch {
        res.writeHead(416, { "Content-Range": `bytes */${size}` }).end();
        return;
      }
      res.writeHead(range ? 206 : 200, {
        "Content-Type": "video/mp4",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        "Accept-Ranges": "bytes",
        "Content-Length": String(range ? range.end - range.start + 1 : size),
        ...(range
          ? { "Content-Range": `bytes ${range.start}-${range.end}/${size}` }
          : {}),
      });
      if (req.method === "HEAD") {
        res.end();
        return;
      }
      const stream = createReadStream(file, range || undefined);
      stream.on("error", () => res.destroy());
      res.on("close", () => stream.destroy());
      stream.pipe(res);
    } catch {
      res.writeHead(404).end();
    }
  });
  server.requestTimeout = 60000;
  server.headersTimeout = 10000;
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Could not serve render footage.");
  const resolved = { ...sources };
  for (const id of ids)
    resolved[id] = `http://127.0.0.1:${address.port}/${token}/${id}`;
  return {
    sources: resolved,
    fingerprints,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((e) => (e ? reject(e) : resolve()));
        server.closeAllConnections();
      }),
  };
}
