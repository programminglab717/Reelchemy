import path from "node:path";
import { lstatSync, realpathSync } from "node:fs";
function canonical(file: string): string {
  try {
    return realpathSync(file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    const parent = path.dirname(file);
    if (parent === file) throw error;
    return path.join(canonical(parent), path.basename(file));
  }
}
function contains(parent: string, child: string) {
  const relative = path.relative(parent, child);
  return (
    relative === "" ||
    (relative !== ".." &&
      !relative.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relative))
  );
}
export function authStorageDirectory(
  env: Record<string, string | undefined> = process.env,
) {
  const data = path.resolve(env.REELCHEMY_DATA_DIR || ".data");
  const auth = path.resolve(env.REELCHEMY_AUTH_DIR || data);
  if (!env.REELCHEMY_AUTH_DIR && env.NODE_ENV !== "production") {
    let restored = false;
    try {
      lstatSync(path.join(path.dirname(data), "RESTORE.json"));
      lstatSync(path.join(path.dirname(data), "auth", "auth.sqlite"));
      restored = true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    if (restored)
      throw new Error(
        "Restored authentication requires the REELCHEMY_AUTH_DIR returned by the restore command.",
      );
  }
  if (env.NODE_ENV === "production") {
    if (!env.REELCHEMY_AUTH_DIR)
      throw new Error(
        "Production authentication requires a separate REELCHEMY_AUTH_DIR.",
      );
    const privateRoot = canonical(auth);
    for (const media of [
      data,
      path.resolve(env.REELCHEMY_ARTIFACT_DIR || "artifacts"),
    ]) {
      const root = canonical(media);
      if (contains(root, privateRoot) || contains(privateRoot, root))
        throw new Error(
          "Authentication storage must be separate from media and exports.",
        );
    }
    for (const file of [
      "auth.sqlite",
      "auth.sqlite-wal",
      "auth.sqlite-shm",
      "auth-secret",
      "mail",
    ]) {
      try {
        lstatSync(path.join(data, file));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
        throw error;
      }
      throw new Error(
        "Legacy authentication files remain in media storage. Use coordinated backup/restore into separate directories before production startup.",
      );
    }
  }
  return auth;
}
