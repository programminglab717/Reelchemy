import {
  constants,
  closeSync,
  mkdirSync,
  openSync,
  realpathSync,
} from "node:fs";
import path from "node:path";

// Resolve only the operator-configured root. Child directories must be real
// directories, and Linux callers keep their inode anchored during file I/O.
export function withPrivateDirectory<T>(
  root: string,
  child: string,
  operation: (anchor: string) => T,
  create = true,
): T {
  if (!/^[a-z][a-z0-9-]{0,60}$/.test(child))
    throw new Error("Invalid private directory.");
  if (create) mkdirSync(root, { recursive: true, mode: 0o700 });
  const resolved = realpathSync(root);
  const parent = openSync(
    resolved,
    constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
  );
  let directory: number | undefined;
  try {
    const parentPath =
      process.platform === "linux" ? `/proc/self/fd/${parent}` : resolved;
    const target = path.join(parentPath, child);
    if (create) mkdirSync(target, { recursive: true, mode: 0o700 });
    directory = openSync(
      target,
      constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
    );
    return operation(
      process.platform === "linux"
        ? `/proc/self/fd/${directory}`
        : realpathSync(target),
    );
  } finally {
    if (directory !== undefined) closeSync(directory);
    closeSync(parent);
  }
}
