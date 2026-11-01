import { readFile, readdir, realpath } from "node:fs/promises";
import path from "node:path";
const root = process.cwd();
const output = path.resolve(process.env.REELCHEMY_NEXT_DIST_DIR || ".next");
const configuredRoots = [
  ".data",
  "artifacts",
  "private-auth",
  process.env.REELCHEMY_DATA_DIR,
  process.env.REELCHEMY_ARTIFACT_DIR,
  process.env.REELCHEMY_AUTH_DIR,
]
  .filter((v): v is string => !!v)
  .map((v) => path.resolve(v));
const privateRoots = [
  ...new Set([
    ...configuredRoots,
    ...(await Promise.all(
      configuredRoots.map(async (directory) => {
        try {
          return await realpath(directory);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === "ENOENT")
            return directory;
          throw error;
        }
      }),
    )),
  ]),
];
function privatePath(file: string) {
  if (path.dirname(file) === root && path.basename(file).startsWith(".env"))
    return true;
  return privateRoots.some((directory) => {
    const relative = path.relative(directory, file);
    return (
      relative === "" ||
      (relative !== ".." &&
        !relative.startsWith(`..${path.sep}`) &&
        !path.isAbsolute(relative))
    );
  });
}
const resolvedPaths = new Map<string, Promise<string>>();
async function tracedPrivatePath(file: string) {
  if (privatePath(file)) return true;
  let resolved = resolvedPaths.get(file);
  if (!resolved) {
    resolved = realpath(file).catch((error) => {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return file;
      throw error;
    });
    resolvedPaths.set(file, resolved);
  }
  return privatePath(await resolved);
}
let checked = 0;
async function walk(directory: string) {
  for (const item of await readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, item.name);
    if (item.isDirectory()) await walk(file);
    else if (item.isFile() && item.name.endsWith(".nft.json")) {
      const trace = JSON.parse(await readFile(file, "utf8"));
      if (
        !Array.isArray(trace.files) ||
        trace.files.some((entry: unknown) => typeof entry !== "string")
      )
        throw new Error("Invalid server trace file.");
      for (const entry of trace.files)
        if (await tracedPrivatePath(path.resolve(directory, entry)))
          throw new Error(
            "Runtime data or environment files entered a server trace.",
          );
      checked++;
    }
  }
}
await walk(output);
try {
  const required = JSON.parse(
    await readFile(path.join(output, "required-server-files.json"), "utf8"),
  );
  if (
    !Array.isArray(required.files) ||
    required.files.some((entry: unknown) => typeof entry !== "string")
  )
    throw new Error("Invalid required server files manifest.");
  for (const entry of required.files)
    if (await tracedPrivatePath(path.resolve(root, entry)))
      throw new Error(
        "Runtime data or environment files entered required server files.",
      );
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
}
if (!checked) throw new Error("No server traces were available to verify.");
console.log(
  "Server traces exclude runtime data, authentication storage and environment files.",
);
