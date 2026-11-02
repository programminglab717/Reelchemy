import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

export const RENDERER_DIRECTORY = "reelchemy-renderer";
const manifestName = "reelchemy-build.json";
const maxBytes = 128 * 1024 ** 2;
const maxFiles = 512;
export class PreparedRendererUnavailable extends Error {
  readonly code = "PREPARED_RENDERER_UNAVAILABLE";
  constructor() {
    super(
      "The prepared video renderer is unavailable. Rebuild the application before starting production rendering.",
    );
  }
}
function buildDirectory() {
  return path.resolve(process.env.REELCHEMY_NEXT_DIST_DIR || ".next");
}
async function buildId(directory: string) {
  const value = await regularFile(path.join(directory, "BUILD_ID"), 256);
  const id = value.toString().trim();
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(id))
    throw new PreparedRendererUnavailable();
  return id;
}
async function regularFile(file: string, limit: number, allowEmpty = false) {
  const handle = await open(
    file,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  );
  try {
    const before = await handle.stat();
    if (
      !before.isFile() ||
      (!allowEmpty && before.size < 1) ||
      before.size > limit
    )
      throw new PreparedRendererUnavailable();
    const bytes = Buffer.alloc(before.size);
    let offset = 0;
    while (offset < bytes.length) {
      const result = await handle.read(
        bytes,
        offset,
        bytes.length - offset,
        offset,
      );
      if (!result.bytesRead) throw new PreparedRendererUnavailable();
      offset += result.bytesRead;
    }
    const after = await handle.stat();
    if (
      before.size !== after.size ||
      before.mtimeMs !== after.mtimeMs ||
      before.ctimeMs !== after.ctimeMs
    )
      throw new PreparedRendererUnavailable();
    return bytes;
  } finally {
    await handle.close();
  }
}
async function inventory(directory: string) {
  const files: { name: string; bytes: number; sha256: string }[] = [];
  let bytes = 0,
    directories = 0;
  async function walk(current: string, relative: string) {
    const stat = await lstat(current);
    if (
      !stat.isDirectory() ||
      stat.isSymbolicLink() ||
      ++directories > maxFiles
    )
      throw new PreparedRendererUnavailable();
    for (const entry of (await readdir(current, { withFileTypes: true })).sort(
      (a, b) => a.name.localeCompare(b.name),
    )) {
      if (!relative && entry.name === manifestName) continue;
      const name = relative ? `${relative}/${entry.name}` : entry.name;
      if (name.length > 512 || entry.isSymbolicLink())
        throw new PreparedRendererUnavailable();
      const file = path.join(current, entry.name);
      if (entry.isDirectory()) await walk(file, name);
      else {
        if (!entry.isFile() || files.length >= maxFiles)
          throw new PreparedRendererUnavailable();
        const contents = await regularFile(file, maxBytes - bytes, true);
        bytes += contents.length;
        files.push({
          name,
          bytes: contents.length,
          sha256: createHash("sha256").update(contents).digest("hex"),
        });
      }
    }
  }
  await walk(directory, "");
  if (
    !files.some((file) => file.name === "index.html") ||
    !files.some((file) => file.name === "bundle.js")
  )
    throw new PreparedRendererUnavailable();
  return files;
}
// Build outputs live in the immutable application image, outside user storage.
// Hashes detect incomplete/corrupt/mixed builds; they are not a signature of an
// untrusted bundle. Production must keep this entire build directory read-only.
export async function sealPreparedRenderer(
  directory: string,
  nextDirectory = buildDirectory(),
) {
  try {
    const manifest = {
      format: "reelchemy-prepared-renderer-v1",
      buildId: await buildId(nextDirectory),
      files: await inventory(directory),
    };
    const encoded = JSON.stringify(manifest);
    if (Buffer.byteLength(encoded) > 128 * 1024)
      throw new PreparedRendererUnavailable();
    await writeFile(path.join(directory, manifestName), encoded, {
      flag: "wx",
      mode: 0o644,
    });
  } catch {
    throw new PreparedRendererUnavailable();
  }
}
export async function verifyPreparedRenderer(nextDirectory = buildDirectory()) {
  try {
    const directory = path.join(nextDirectory, RENDERER_DIRECTORY);
    for (const root of [nextDirectory, directory]) {
      const metadata = await lstat(root);
      if (!metadata.isDirectory() || metadata.isSymbolicLink())
        throw new PreparedRendererUnavailable();
    }
    const manifest = JSON.parse(
      (
        await regularFile(path.join(directory, manifestName), 128 * 1024)
      ).toString(),
    );
    if (
      manifest.format !== "reelchemy-prepared-renderer-v1" ||
      manifest.buildId !== (await buildId(nextDirectory)) ||
      JSON.stringify(manifest.files) !==
        JSON.stringify(await inventory(directory))
    )
      throw new PreparedRendererUnavailable();
    return directory;
  } catch {
    throw new PreparedRendererUnavailable();
  }
}
let prepared: Promise<string> | undefined;
export function preparedRenderer() {
  return (prepared ??= verifyPreparedRenderer().catch((error) => {
    prepared = undefined;
    throw error;
  }));
}
