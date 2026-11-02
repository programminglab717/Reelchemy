import {
  constants,
  openSync,
  closeSync,
  fstatSync,
  lstatSync,
  opendirSync,
  mkdirSync,
  realpathSync,
  readSync,
  writeFileSync,
  unlinkSync,
  rmdirSync,
} from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";
import {
  cacheRetentionPolicy,
  CacheRetentionUnavailable,
  type CacheRetentionPolicy,
} from "./cache-retention-policy";
import { renderCacheRootDirectory } from "./render-cache-path";
const MARKER = ".reelchemy-scene-cache-v1";
const MARKER_CONTENT = "reelchemy-derived-scene-cache-v1\n";
const NAMESPACE = /^(?:local|legacy|[a-f0-9-]{36})$/;
const KEY = /^[a-f0-9]{64}$/;
const PARTIAL = /^\.partial-[a-f0-9-]{36}$/;
const SCAN_LIMIT = 100000;
type File = { name: string; identity: string; bytes: number; modified: number };
type Tree = { name: string; identity: string; files: File[]; children: Tree[] };
type Entry = {
  namespace: string;
  key: string;
  bytes: number;
  lastUsed: number;
  partial: boolean;
  tree: Tree;
};
type Inventory = {
  identity: string;
  signature: string;
  entries: Entry[];
  namespaces: { name: string; identity: string }[];
  managed: boolean;
};
export type CacheRetentionPlan = {
  root: string;
  policy: CacheRetentionPolicy;
  identity: string;
  signature: string;
  emptyNamespaces?: string[];
  remove: {
    namespace: string;
    key: string;
    reason: "interrupted" | "expired" | "studio" | "shared";
  }[];
  report: CacheRetentionReport;
};
export type CacheRetentionReport = {
  exists: boolean;
  managed: boolean;
  entries: number;
  bytes: number;
  removeEntries: number;
  removeBytes: number;
  retainedEntries: number;
  retainedBytes: number;
};
function identity(stat: ReturnType<typeof fstatSync>) {
  return `${stat.dev}:${stat.ino}`;
}
function canonical(directory: string) {
  const resolved = path.resolve(directory);
  try {
    return realpathSync(resolved);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return resolved;
    throw error;
  }
}
function inside(child: string, parent: string) {
  const relative = path.relative(parent, child);
  return (
    !relative ||
    (!relative.startsWith(`..${path.sep}`) &&
      relative !== ".." &&
      !path.isAbsolute(relative))
  );
}
function checkedRoot(input: string) {
  const root = canonical(input);
  const data = canonical(process.env.REELCHEMY_DATA_DIR || ".data");
  const artifacts = canonical(
    process.env.REELCHEMY_ARTIFACT_DIR || "artifacts",
  );
  const auth = process.env.REELCHEMY_AUTH_DIR
    ? canonical(process.env.REELCHEMY_AUTH_DIR)
    : undefined;
  const primaryData = ["assets", "media-inputs", "waveforms", "mail"].map(
    (name) => canonical(path.join(data, name)),
  );
  const exportChild = path.relative(artifacts, root).split(path.sep)[0];
  if (
    path.dirname(root) === root ||
    primaryData.some(
      (directory) => inside(root, directory) || inside(directory, root),
    ) ||
    (inside(root, artifacts) && /^[a-f0-9-]{36}$/.test(exportChild)) ||
    [data, artifacts, ...(auth ? [auth] : [])].some((protectedRoot) =>
      inside(protectedRoot, root),
    ) ||
    (auth !== undefined && inside(root, auth))
  )
    throw new CacheRetentionUnavailable();
  return root;
}
function anchor(fd: number, children = false) {
  if (process.platform !== "linux") throw new CacheRetentionUnavailable();
  return children ? `/proc/${process.pid}/fd/${fd}` : `/proc/self/fd/${fd}`;
}
function openDirectory(directory: string) {
  return openSync(
    directory,
    constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
  );
}
function withRoot<T>(
  input: string,
  operation: (root: string, fd: number) => T,
): T | undefined {
  const root = checkedRoot(input);
  let fd: number;
  try {
    fd = openDirectory(root);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  try {
    return operation(root, fd);
  } finally {
    closeSync(fd);
  }
}
function marker(root: string) {
  let fd: number | undefined;
  try {
    fd = openSync(
      path.join(root, MARKER),
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size !== Buffer.byteLength(MARKER_CONTENT))
      throw new CacheRetentionUnavailable();
    const bytes = Buffer.alloc(stat.size);
    if (
      readSync(fd, bytes, 0, bytes.length, 0) !== bytes.length ||
      bytes.toString() !== MARKER_CONTENT
    )
      throw new CacheRetentionUnavailable();
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}
function establishMarker(root: string) {
  if (marker(root)) return;
  const fd = openSync(
    path.join(root, MARKER),
    constants.O_WRONLY |
      constants.O_CREAT |
      constants.O_EXCL |
      constants.O_NOFOLLOW,
    0o600,
  );
  try {
    writeFileSync(fd, MARKER_CONTENT);
  } finally {
    closeSync(fd);
  }
}
function scan(fd: number): Inventory {
  const started = performance.now();
  let visited = 0;
  const events: string[] = [];
  function budget() {
    if (++visited > SCAN_LIMIT || performance.now() - started > 15000)
      throw new CacheRetentionUnavailable();
  }
  function names(directory: string) {
    const dir = opendirSync(directory);
    const result: string[] = [];
    try {
      for (;;) {
        const item = dir.readSync();
        if (!item) break;
        budget();
        result.push(item.name);
      }
    } finally {
      dir.closeSync();
    }
    return result.sort();
  }
  function tree(
    parent: string,
    name: string,
    relative: string,
    staging = false,
    frames = false,
  ): Tree {
    const directory = openDirectory(path.join(parent, name));
    try {
      const meta = fstatSync(directory);
      const result: Tree = {
        name,
        identity: identity(meta),
        files: [],
        children: [],
      };
      events.push(`${relative}:directory:${result.identity}`);
      for (const item of names(anchor(directory))) {
        const file = path.join(anchor(directory), item);
        const stat = lstatSync(file);
        if (
          staging &&
          /^static-[A-Za-z0-9]{6}$/.test(item) &&
          stat.isDirectory()
        ) {
          result.children.push(
            tree(anchor(directory), item, `${relative}/${item}`, false, true),
          );
        } else if (
          (frames
            ? /^frame-\d{4}\.jpeg$/.test(item)
            : ["video.mp4", "manifest.json"].includes(item)) &&
          stat.isFile()
        ) {
          if (!Number.isSafeInteger(stat.size) || stat.size < 0)
            throw new CacheRetentionUnavailable();
          const value = {
            name: item,
            identity: identity(stat),
            bytes: stat.size,
            modified: stat.mtimeMs,
          };
          result.files.push(value);
          events.push(
            `${relative}/${item}:file:${value.identity}:${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`,
          );
        } else throw new CacheRetentionUnavailable();
      }
      return result;
    } finally {
      closeSync(directory);
    }
  }
  const root = anchor(fd),
    entries: Entry[] = [],
    namespaces: Inventory["namespaces"] = [];
  const managed = marker(root);
  for (const namespace of names(root)) {
    if (namespace === MARKER) continue;
    if (!NAMESPACE.test(namespace)) throw new CacheRetentionUnavailable();
    const directory = openDirectory(path.join(root, namespace));
    try {
      const id = identity(fstatSync(directory));
      namespaces.push({ name: namespace, identity: id });
      events.push(`${namespace}:namespace:${id}`);
      for (const key of names(anchor(directory))) {
        if (!KEY.test(key) && !PARTIAL.test(key))
          throw new CacheRetentionUnavailable();
        const partial = PARTIAL.test(key);
        const item = tree(
          anchor(directory),
          key,
          `${namespace}/${key}`,
          partial,
        );
        // Temporary still frames use hard links. Account for each inode once,
        // while ordinary cached videos retain their complete logical byte size.
        const seen = new Set<string>();
        function size(t: Tree): number {
          return (
            t.files.reduce((sum, file) => {
              if (seen.has(file.identity)) return sum;
              seen.add(file.identity);
              return sum + file.bytes;
            }, 0) + t.children.reduce((sum, child) => sum + size(child), 0)
          );
        }
        const lastUsed =
          item.files.find((file) => file.name === "manifest.json")?.modified ??
          item.files.find((file) => file.name === "video.mp4")?.modified ??
          0;
        entries.push({
          namespace,
          key,
          bytes: size(item),
          lastUsed,
          partial,
          tree: item,
        });
      }
    } finally {
      closeSync(directory);
    }
  }
  return {
    identity: identity(fstatSync(fd)),
    signature: createHash("sha256")
      .update(events.sort().join("\n"))
      .digest("hex"),
    entries,
    namespaces,
    managed,
  };
}
function select(
  root: string,
  inventory: Inventory | undefined,
  policy: CacheRetentionPolicy,
  now: number,
): CacheRetentionPlan {
  const entries = inventory?.entries ?? [];
  const remove: CacheRetentionPlan["remove"] = [];
  const removed = new Set<Entry>();
  const drop = (
    entry: Entry,
    reason: CacheRetentionPlan["remove"][number]["reason"],
  ) => {
    if (!removed.has(entry)) {
      removed.add(entry);
      remove.push({ namespace: entry.namespace, key: entry.key, reason });
    }
  };
  for (const entry of entries) {
    if (entry.partial) drop(entry, "interrupted");
    else if (now - entry.lastUsed >= policy.maxAgeMs) drop(entry, "expired");
  }
  const oldest = entries
    .filter((entry) => !removed.has(entry))
    .sort(
      (a, b) =>
        a.lastUsed - b.lastUsed ||
        `${a.namespace}/${a.key}`.localeCompare(`${b.namespace}/${b.key}`),
    );
  const studios = new Map<string, number>();
  for (const entry of oldest)
    studios.set(
      entry.namespace,
      (studios.get(entry.namespace) ?? 0) + entry.bytes,
    );
  for (const entry of oldest)
    if (studios.get(entry.namespace)! > policy.workspaceBytes) {
      drop(entry, "studio");
      studios.set(entry.namespace, studios.get(entry.namespace)! - entry.bytes);
    }
  let bytes = oldest
    .filter((entry) => !removed.has(entry))
    .reduce((total, entry) => total + entry.bytes, 0);
  let count = oldest.filter((entry) => !removed.has(entry)).length;
  for (const entry of oldest)
    if (
      !removed.has(entry) &&
      (bytes > policy.totalBytes || count > policy.entries)
    ) {
      drop(entry, "shared");
      bytes -= entry.bytes;
      count--;
    }
  const total = entries.reduce((sum, entry) => sum + entry.bytes, 0);
  return {
    root,
    policy,
    identity: inventory?.identity ?? "",
    signature: inventory?.signature ?? "",
    remove,
    report: {
      exists: !!inventory,
      managed: inventory?.managed ?? false,
      entries: entries.length,
      bytes: total,
      removeEntries: removed.size,
      removeBytes: total - bytes,
      retainedEntries: count,
      retainedBytes: bytes,
    },
  };
}
export function planSceneCacheRetention(
  policy = cacheRetentionPolicy(),
  root = renderCacheRootDirectory(),
  now = Date.now(),
): CacheRetentionPlan {
  try {
    return select(
      checkedRoot(root),
      withRoot(root, (_root, fd) => scan(fd)),
      policy,
      now,
    );
  } catch {
    throw new CacheRetentionUnavailable();
  }
}
function removeTree(parent: string, tree: Tree) {
  const fd = openDirectory(path.join(parent, tree.name));
  try {
    if (identity(fstatSync(fd)) !== tree.identity)
      throw new CacheRetentionUnavailable();
    for (const child of tree.children) removeTree(anchor(fd), child);
    for (const file of tree.files) {
      const target = path.join(anchor(fd), file.name),
        stat = lstatSync(target);
      if (
        !stat.isFile() ||
        identity(stat) !== file.identity ||
        stat.size !== file.bytes
      )
        throw new CacheRetentionUnavailable();
      unlinkSync(target);
    }
    if (identity(lstatSync(path.join(parent, tree.name))) !== tree.identity)
      throw new CacheRetentionUnavailable();
    rmdirSync(path.join(parent, tree.name));
  } finally {
    closeSync(fd);
  }
}
// Invoke only between exports under the permanent render-worker lifecycle lock.
// Inspection is read-only; apply rechecks the complete closed tree and identities.
export function applySceneCacheRetention(
  plan: CacheRetentionPlan,
): CacheRetentionReport {
  try {
    const report = withRoot(plan.root, (_root, fd) => {
      const current = scan(fd);
      if (
        current.identity !== plan.identity ||
        current.signature !== plan.signature
      )
        throw new CacheRetentionUnavailable();
      establishMarker(anchor(fd));
      for (const selected of plan.remove) {
        const entry = current.entries.find(
          (entry) =>
            entry.namespace === selected.namespace &&
            entry.key === selected.key,
        );
        if (!entry) throw new CacheRetentionUnavailable();
        const directory = openDirectory(path.join(anchor(fd), entry.namespace));
        try {
          removeTree(anchor(directory), entry.tree);
        } finally {
          closeSync(directory);
        }
      }
      for (const namespace of current.namespaces) {
        if (
          plan.emptyNamespaces &&
          !plan.emptyNamespaces.includes(namespace.name)
        )
          continue;
        const directory = openDirectory(path.join(anchor(fd), namespace.name));
        try {
          if (identity(fstatSync(directory)) !== namespace.identity)
            throw new CacheRetentionUnavailable();
          const child = opendirSync(anchor(directory));
          let empty: boolean;
          try {
            empty = child.readSync() === null;
          } finally {
            child.closeSync();
          }
          if (empty) {
            if (
              identity(lstatSync(path.join(anchor(fd), namespace.name))) !==
              namespace.identity
            )
              throw new CacheRetentionUnavailable();
            rmdirSync(path.join(anchor(fd), namespace.name));
          }
        } finally {
          closeSync(directory);
        }
      }
      return { ...plan.report, managed: true };
    });
    if (!report && plan.report.exists) throw new CacheRetentionUnavailable();
    return report ?? plan.report;
  } catch {
    throw new CacheRetentionUnavailable();
  }
}
export function maintainSceneCache(policy = cacheRetentionPolicy()) {
  return applySceneCacheRetention(planSceneCacheRetention(policy));
}
export function openSceneCacheNamespace(namespace: string) {
  if (!NAMESPACE.test(namespace)) throw new CacheRetentionUnavailable();
  let namespaceFd: number | undefined;
  try {
    const root = checkedRoot(renderCacheRootDirectory());
    mkdirSync(root, { recursive: true, mode: 0o700 });
    withRoot(root, (_root, fd) => {
      if (!marker(anchor(fd))) {
        scan(fd);
        establishMarker(anchor(fd));
      }
      mkdirSync(path.join(anchor(fd), namespace), {
        recursive: true,
        mode: 0o700,
      });
      namespaceFd = openDirectory(path.join(anchor(fd), namespace));
    });
    if (namespaceFd === undefined) throw new CacheRetentionUnavailable();
    const fd = namespaceFd;
    return { directory: anchor(fd, true), close: () => closeSync(fd) };
  } catch {
    if (namespaceFd !== undefined) closeSync(namespaceFd);
    throw new CacheRetentionUnavailable();
  }
}

// Permanent project cleanup may clear this studio's derived clips, but may not
// infer ownership of unknown files or follow a cache misconfiguration into data.
export function removeSceneCacheNamespace(namespace: string) {
  if (!NAMESPACE.test(namespace)) throw new CacheRetentionUnavailable();
  try {
    withRoot(renderCacheRootDirectory(), (root, fd) => {
      const target = path.join(anchor(fd), namespace);
      let entry;
      try {
        entry = lstatSync(target);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
        throw error;
      }
      if (entry.isSymbolicLink()) {
        if (identity(lstatSync(target)) !== identity(entry))
          throw new CacheRetentionUnavailable();
        unlinkSync(target);
        return;
      }
      if (!entry.isDirectory()) throw new CacheRetentionUnavailable();
      const current = scan(fd),
        selected = current.entries.filter(
          (value) => value.namespace === namespace,
        );
      const total = current.entries.reduce(
          (sum, value) => sum + value.bytes,
          0,
        ),
        removed = selected.reduce((sum, value) => sum + value.bytes, 0);
      applySceneCacheRetention({
        root,
        policy: cacheRetentionPolicy(),
        identity: current.identity,
        signature: current.signature,
        remove: selected.map((value) => ({
          namespace,
          key: value.key,
          reason: "studio" as const,
        })),
        emptyNamespaces: [namespace],
        report: {
          exists: true,
          managed: current.managed,
          entries: current.entries.length,
          bytes: total,
          removeEntries: selected.length,
          removeBytes: removed,
          retainedEntries: current.entries.length - selected.length,
          retainedBytes: total - removed,
        },
      });
    });
  } catch {
    throw new CacheRetentionUnavailable();
  }
}
